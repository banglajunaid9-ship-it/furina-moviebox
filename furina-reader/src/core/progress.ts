import { dataEvents, db, getDeviceId } from './db';
import { getTitle, listChapters, listTitles, saveTitle } from './library';
import { queueChange } from './sync/outbox';
import type { Chapter, HistoryEntry, Progress, Title } from './types';
import { now, uid } from './util';

export async function getProgress(chapterId: string) {
  return (await db()).get('progress', chapterId);
}

export async function progressForTitle(titleId: string): Promise<Map<string, Progress>> {
  const list = await (await db()).getAllFromIndex('progress', 'byTitle', titleId);
  return new Map(list.map((p) => [p.chapterId, p]));
}

/** Persist the reader position. `completed` becomes true on the last page and never reverts automatically. */
export async function saveProgress(chapter: Chapter, page: number, pageCount: number) {
  const d = await db();
  const prev = await d.get('progress', chapter.id);
  const p: Progress = {
    chapterId: chapter.id,
    titleId: chapter.titleId,
    page,
    pageCount,
    completed: (prev?.completed ?? false) || (pageCount > 0 && page >= pageCount - 1),
    updatedAt: now(),
    deviceId: getDeviceId(),
  };
  await d.put('progress', p);
  await queueChange('progress', p.chapterId, p);

  const t = await getTitle(chapter.titleId);
  if (t) {
    const patch: Partial<Title> = { lastReadAt: p.updatedAt };
    if (t.status === 'plan_to_read' || t.status === 'on_hold') patch.status = 'reading';
    await saveTitle({ ...t, ...patch });
  }
  dataEvents.emit('progress');
  return p;
}

export async function setChapterRead(chapter: Chapter, read: boolean) {
  const d = await db();
  if (!read) {
    await d.delete('progress', chapter.id);
    await queueChange('progress', chapter.id, null, 'delete');
  } else {
    const n = chapter.pageCount ?? 1;
    const p: Progress = { chapterId: chapter.id, titleId: chapter.titleId, page: n - 1, pageCount: n, completed: true, updatedAt: now(), deviceId: getDeviceId() };
    await d.put('progress', p);
    await queueChange('progress', p.chapterId, p);
  }
  dataEvents.emit('progress');
}

/** The chapter to open when the user hits "Continue" on a title. */
export async function resumeTarget(titleId: string): Promise<{ chapter: Chapter; page: number } | undefined> {
  const chapters = await listChapters(titleId);
  if (!chapters.length) return undefined;
  const prog = await progressForTitle(titleId);
  const latest = [...prog.values()].sort((a, b) => b.updatedAt - a.updatedAt)[0];
  if (latest) {
    const idx = chapters.findIndex((c) => c.id === latest.chapterId);
    if (idx >= 0) {
      if (!latest.completed) return { chapter: chapters[idx], page: latest.page };
      const next = chapters.slice(idx + 1).find((c) => !prog.get(c.id)?.completed);
      if (next) return { chapter: next, page: prog.get(next.id)?.page ?? 0 };
      return { chapter: chapters[idx], page: latest.page };
    }
  }
  const firstUnread = chapters.find((c) => !prog.get(c.id)?.completed) ?? chapters[0];
  return { chapter: firstUnread, page: prog.get(firstUnread.id)?.page ?? 0 };
}

/* -------------------------------------------------------------------------- */
/* History & reading sessions                                                 */
/* -------------------------------------------------------------------------- */

/** Tracks active reading time for one open chapter; pauses while the tab is hidden or idle. */
export class ReadingSession {
  private entry: HistoryEntry;
  private lastTick = now();
  private active = true;
  private pages = new Set<number>();
  private idleTimer?: ReturnType<typeof setTimeout>;
  private onVis = () => this.setActive(document.visibilityState === 'visible');

  constructor(chapter: Chapter) {
    this.entry = { id: uid(), titleId: chapter.titleId, chapterId: chapter.id, startedAt: now(), endedAt: now(), pagesRead: 0, durationMs: 0 };
    document.addEventListener('visibilitychange', this.onVis);
    this.bump();
  }
  private setActive(a: boolean) {
    this.tick();
    this.active = a;
  }
  private tick() {
    const t = now();
    if (this.active) this.entry.durationMs += Math.min(t - this.lastTick, 120_000);
    this.lastTick = t;
  }
  /** Call on any user interaction; 2 minutes without one counts as idle. */
  bump() {
    if (!this.active) this.setActive(true);
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.setActive(false), 120_000);
  }
  pageSeen(i: number) {
    this.pages.add(i);
    this.bump();
  }
  async end() {
    document.removeEventListener('visibilitychange', this.onVis);
    clearTimeout(this.idleTimer);
    this.tick();
    this.entry.endedAt = now();
    this.entry.pagesRead = this.pages.size;
    if (this.entry.pagesRead === 0 && this.entry.durationMs < 3000) return; // opened by accident
    await (await db()).put('history', this.entry);
    await queueChange('history', this.entry.id, this.entry);
    dataEvents.emit('history');
  }
}

export interface HistoryRow {
  entry: HistoryEntry;
  title?: Title;
  chapter?: Chapter;
}

/** Most recent session per chapter, newest first. */
export async function listHistory(limit = 200): Promise<HistoryRow[]> {
  const d = await db();
  const all = await d.getAllFromIndex('history', 'byEnded');
  const seen = new Set<string>();
  const rows: HistoryRow[] = [];
  for (let i = all.length - 1; i >= 0 && rows.length < limit; i--) {
    const e = all[i];
    if (seen.has(e.chapterId)) continue;
    seen.add(e.chapterId);
    const title = await d.get('titles', e.titleId);
    const chapter = await d.get('chapters', e.chapterId);
    if (!title || title.deleted || !chapter || chapter.deleted) continue;
    rows.push({ entry: e, title, chapter });
  }
  return rows;
}

export async function clearHistory(titleId?: string) {
  const d = await db();
  const tx = d.transaction('history', 'readwrite');
  for (const e of await tx.store.getAll()) {
    if (!titleId || e.titleId === titleId) {
      await tx.store.delete(e.id);
      await queueChange('history', e.id, null, 'delete');
    }
  }
  await tx.done;
  dataEvents.emit('history');
}

export interface ReadingStats {
  titles: number;
  chaptersRead: number;
  pagesRead: number;
  timeMs: number;
  streakDays: number;
  byStatus: Record<string, number>;
  last7: { day: string; ms: number }[];
}

export async function readingStats(): Promise<ReadingStats> {
  const d = await db();
  const titles = await listTitles();
  const progress = await d.getAll('progress');
  const history = await d.getAll('history');
  const byStatus: Record<string, number> = {};
  for (const t of titles) byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;

  const dayKey = (ts: number) => new Date(ts).toISOString().slice(0, 10);
  const perDay = new Map<string, number>();
  for (const h of history) perDay.set(dayKey(h.endedAt), (perDay.get(dayKey(h.endedAt)) ?? 0) + h.durationMs);
  let streak = 0;
  for (let i = 0; ; i++) {
    const k = dayKey(Date.now() - i * 86400_000);
    if (perDay.has(k)) streak++;
    else if (i > 0) break;
    else continue; // today not read yet doesn't break the streak
  }
  const last7 = Array.from({ length: 7 }, (_, i) => {
    const ts = Date.now() - (6 - i) * 86400_000;
    return { day: new Date(ts).toLocaleDateString(undefined, { weekday: 'short' }), ms: perDay.get(dayKey(ts)) ?? 0 };
  });
  return {
    titles: titles.length,
    chaptersRead: progress.filter((p) => p.completed).length,
    pagesRead: history.reduce((s, h) => s + h.pagesRead, 0),
    timeMs: history.reduce((s, h) => s + h.durationMs, 0),
    streakDays: streak,
    byStatus,
    last7,
  };
}
