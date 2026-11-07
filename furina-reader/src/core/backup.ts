import { dataEvents, db, kvGet, kvSet } from './db';
import type { Chapter, Collection, HistoryEntry, Progress, Title } from './types';

/**
 * JSON backup of everything except file contents (which can be large and are
 * re-importable). Import merges: newer `updatedAt` wins per record.
 */
export interface Backup {
  app: 'furina-reader';
  version: 1;
  exportedAt: number;
  titles: Title[];
  chapters: Chapter[];
  progress: Progress[];
  history: HistoryEntry[];
  collections: Collection[];
  settings?: unknown;
}

export async function exportBackup(): Promise<Backup> {
  const d = await db();
  const strip = <T extends { cover?: string }>(t: T) => ({ ...t, cover: t.cover?.startsWith('file:') ? '' : t.cover });
  return {
    app: 'furina-reader',
    version: 1,
    exportedAt: Date.now(),
    titles: (await d.getAll('titles')).filter((t) => !t.deleted).map(strip),
    chapters: (await d.getAll('chapters')).filter((c) => !c.deleted).map((c) => ({ ...c, fileId: undefined })),
    progress: await d.getAll('progress'),
    history: await d.getAll('history'),
    collections: (await d.getAll('collections')).filter((c) => !c.deleted),
    settings: await kvGet('settings'),
  };
}

export function validateBackup(x: unknown): Backup {
  const b = x as Partial<Backup>;
  if (!b || b.app !== 'furina-reader' || b.version !== 1) throw new Error('This is not a Furina Reader backup file.');
  for (const k of ['titles', 'chapters', 'progress', 'history', 'collections'] as const) {
    if (!Array.isArray(b[k])) throw new Error(`Backup is missing "${k}".`);
  }
  const bad = b.titles!.find((t) => typeof t?.id !== 'string' || typeof t?.title !== 'string');
  if (bad) throw new Error('Backup contains an invalid title record.');
  return b as Backup;
}

export async function importBackup(raw: unknown): Promise<{ titles: number; chapters: number; progress: number }> {
  const b = validateBackup(raw);
  const d = await db();
  const counts = { titles: 0, chapters: 0, progress: 0 };
  const tx = d.transaction(['titles', 'chapters', 'progress', 'history', 'collections'], 'readwrite');
  const newer = (a?: { updatedAt?: number }, b2?: { updatedAt?: number }) => !a || (b2?.updatedAt ?? 0) > (a.updatedAt ?? 0);

  for (const t of b.titles) {
    const cur = await tx.objectStore('titles').get(t.id);
    if (newer(cur, t)) {
      await tx.objectStore('titles').put({ ...t, cover: cur?.cover && !t.cover ? cur.cover : t.cover });
      counts.titles++;
    }
  }
  for (const c of b.chapters) {
    const cur = await tx.objectStore('chapters').get(c.id);
    if (newer(cur, c)) {
      await tx.objectStore('chapters').put({ ...c, fileId: cur?.fileId });
      counts.chapters++;
    }
  }
  for (const p of b.progress) {
    const cur = await tx.objectStore('progress').get(p.chapterId);
    if (!cur || p.page > cur.page || (p.completed && !cur.completed)) {
      await tx.objectStore('progress').put(p);
      counts.progress++;
    }
  }
  for (const h of b.history) await tx.objectStore('history').put(h);
  for (const c of b.collections) {
    const cur = await tx.objectStore('collections').get(c.id);
    if (newer(cur, c)) await tx.objectStore('collections').put(c);
  }
  await tx.done;
  if (b.settings && !(await kvGet('settings'))) await kvSet('settings', b.settings);
  ['titles', 'chapters', 'progress', 'history', 'collections'].forEach((s) => dataEvents.emit(s));
  return counts;
}
