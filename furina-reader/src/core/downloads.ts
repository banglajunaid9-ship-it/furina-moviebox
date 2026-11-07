import { zipSync } from 'fflate';
import { dataEvents, db } from './db';
import { getSource } from './extensions/registry';
import { OpdsSource } from './extensions/opds';
import { getTitle } from './library';
import type { Chapter, DownloadTask } from './types';
import { now, uid } from './util';

/**
 * Download manager: persistent queue (IndexedDB), 2 concurrent jobs,
 * pause/resume (HTTP Range for archive sources), automatic retry with
 * back-off, and offline storage of the finished chapter.
 */
const CONCURRENCY = 2;
const MAX_AUTO_RETRIES = 3;

const controllers = new Map<string, AbortController>();
const partials = new Map<string, Blob>();
let pumping = false;

const emit = () => dataEvents.emit('downloads');

async function put(task: DownloadTask) {
  await (await db()).put('downloads', { ...task, updatedAt: now() });
  emit();
}

export async function listDownloads(): Promise<DownloadTask[]> {
  return (await (await db()).getAll('downloads')).sort((a, b) => a.createdAt - b.createdAt);
}

export async function isOffline(chapterId: string) {
  return !!(await (await db()).getKey('offline', chapterId));
}

export async function enqueue(chapters: Chapter[]) {
  const d = await db();
  for (const c of chapters) {
    if (c.fileId || c.format !== 'remote') continue; // local files are already offline
    if (await isOffline(c.id)) continue;
    const existing = await d.getFromIndex('downloads', 'byChapter', c.id);
    if (existing && existing.state !== 'failed') continue;
    const t = await getTitle(c.titleId);
    await put({
      id: existing?.id ?? uid(),
      titleId: c.titleId,
      chapterId: c.id,
      label: `${t?.title ?? 'Unknown'} — ${c.name}`,
      state: 'queued',
      receivedBytes: 0,
      totalBytes: 0,
      attempts: 0,
      createdAt: existing?.createdAt ?? now(),
      updatedAt: now(),
    });
  }
  void pump();
}

export async function pause(id: string) {
  const d = await db();
  const t = await d.get('downloads', id);
  if (!t || (t.state !== 'downloading' && t.state !== 'queued')) return;
  controllers.get(id)?.abort('paused');
  await put({ ...t, state: 'paused' });
}

export async function resume(id: string) {
  const t = await (await db()).get('downloads', id);
  if (!t || (t.state !== 'paused' && t.state !== 'failed')) return;
  await put({ ...t, state: 'queued', error: undefined, attempts: t.state === 'failed' ? 0 : t.attempts });
  void pump();
}

export async function cancel(id: string) {
  controllers.get(id)?.abort('cancelled');
  partials.delete(id);
  await (await db()).delete('downloads', id);
  emit();
}

export async function clearFinished() {
  const d = await db();
  for (const t of await d.getAll('downloads')) if (t.state === 'done') await d.delete('downloads', t.id);
  emit();
}

export async function deleteOffline(chapterId: string) {
  const d = await db();
  await d.delete('offline', chapterId);
  const t = await d.getFromIndex('downloads', 'byChapter', chapterId);
  if (t) await d.delete('downloads', t.id);
  emit();
}

export async function offlineUsage(): Promise<{ count: number; bytes: number; items: { chapterId: string; size: number; name: string }[] }> {
  const all = await (await db()).getAll('offline');
  return { count: all.length, bytes: all.reduce((s, o) => s + o.blob.size, 0), items: all.map((o) => ({ chapterId: o.chapterId, size: o.blob.size, name: o.name })) };
}

/** Resume interrupted work after app restart. */
export async function initDownloads() {
  const d = await db();
  for (const t of await d.getAll('downloads')) if (t.state === 'downloading') await d.put('downloads', { ...t, state: 'queued' });
  void pump();
  window.addEventListener('online', () => void pump());
}

async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    for (;;) {
      if (!navigator.onLine) return;
      const all = await listDownloads();
      const running = all.filter((t) => t.state === 'downloading').length;
      const next = all.find((t) => t.state === 'queued');
      if (!next || running >= CONCURRENCY) return;
      await put({ ...next, state: 'downloading' });
      void run(next.id);
    }
  } finally {
    pumping = false;
  }
}

async function run(id: string) {
  const d = await db();
  let task = (await d.get('downloads', id))!;
  const ctl = new AbortController();
  controllers.set(id, ctl);
  let lastWrite = 0;
  const progress = (received: number, total: number) => {
    task = { ...task, receivedBytes: received, totalBytes: total };
    if (Date.now() - lastWrite > 400) {
      lastWrite = Date.now();
      void put(task);
    }
  };
  try {
    const chapter = await d.get('chapters', task.chapterId);
    const title = chapter && (await getTitle(chapter.titleId));
    if (!chapter?.sourceKey || !title) throw new Error('Chapter no longer exists.');
    const src = await getSource(title.sourceId);
    if (!src) throw new Error('Source not installed.');

    let blob: Blob;
    let name: string;
    if (src instanceof OpdsSource && !JSON.parse(chapter.sourceKey).s) {
      const r = await src.download(chapter.sourceKey, progress, ctl.signal, partials.get(id));
      blob = r.blob;
      name = r.name;
    } else {
      const pages = await src.pages(chapter.sourceKey);
      if (pages.type === 'archive') {
        blob = pages.blob;
        name = pages.name;
      } else {
        // Fetch every page image and pack them into a stored (uncompressed) CBZ.
        const files: Record<string, Uint8Array> = {};
        let bytes = 0;
        for (let i = 0; i < pages.urls.length; i++) {
          if (ctl.signal.aborted) throw new DOMException('Aborted', 'AbortError');
          let attempt = 0;
          for (;;) {
            try {
              const res = await fetch(pages.urls[i], { signal: ctl.signal, credentials: 'omit' });
              if (!res.ok) throw new Error(`Page ${i + 1}: HTTP ${res.status}`);
              const buf = new Uint8Array(await res.arrayBuffer());
              const ext = (res.headers.get('content-type') || '').split('/')[1]?.split(';')[0] || 'jpg';
              files[`${String(i + 1).padStart(4, '0')}.${ext === 'jpeg' ? 'jpg' : ext}`] = buf;
              bytes += buf.byteLength;
              break;
            } catch (e) {
              if (ctl.signal.aborted || ++attempt >= 3) throw e;
              await new Promise((r) => setTimeout(r, 800 * attempt));
            }
          }
          progress(i + 1, pages.urls.length);
        }
        blob = new Blob([zipSync(files, { level: 0 }) as BlobPart], { type: 'application/vnd.comicbook+zip' });
        name = `${chapter.name}.cbz`;
        task.totalBytes = task.receivedBytes = bytes;
      }
    }
    await d.put('offline', { chapterId: chapter.id, blob, name, savedAt: now() });
    partials.delete(id);
    await put({ ...task, state: 'done', receivedBytes: blob.size, totalBytes: blob.size, error: undefined });
    dataEvents.emit('chapters');
  } catch (e) {
    const reason = ctl.signal.reason;
    const partial = (e as { partial?: Blob }).partial;
    // `partial` already includes any earlier resumed bytes
    if (partial?.size) partials.set(id, partial);
    const current = await d.get('downloads', id);
    if (!current) return; // cancelled
    if (reason === 'paused' || current.state === 'paused') {
      await put({ ...task, state: 'paused' });
    } else {
      const attempts = task.attempts + 1;
      const msg = e instanceof Error ? e.message : String(e);
      if (attempts < MAX_AUTO_RETRIES && navigator.onLine) {
        await put({ ...task, attempts, error: msg, state: 'paused' });
        setTimeout(() => void resume(id), 1500 * 2 ** attempts);
      } else {
        await put({ ...task, attempts, error: msg, state: 'failed' });
      }
    }
  } finally {
    controllers.delete(id);
    void pump();
  }
}
