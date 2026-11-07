import { dataEvents, db } from './db';
import { openSource, sniffFormat, EpubSource } from './importers/sources';
import { queueChange } from './sync/outbox';
import type { Chapter, Collection, ContentFormat, FileRecord, ReadingStatus, Title } from './types';
import { fingerprintBlob, isImageName, naturalCompare, normalizeTitle, now, parseFileName, uid } from './util';

/* Strip blobs & local-only fields before a row leaves the device. */
const syncableTitle = (t: Title) => ({ ...t, cover: t.cover.startsWith('file:') ? '' : t.cover });
const syncableChapter = (c: Chapter) => ({ ...c, fileId: undefined });

export function newTitle(partial: Partial<Title> & Pick<Title, 'title'>): Title {
  const t = now();
  return {
    id: uid(),
    sourceId: 'local',
    sourceKey: '',
    altTitles: [],
    authors: [],
    artists: [],
    description: '',
    genres: [],
    cover: '',
    status: 'plan_to_read',
    favorite: false,
    collectionIds: [],
    inLibrary: true,
    addedAt: t,
    updatedAt: t,
    ...partial,
  };
}

/* -------------------------------------------------------------------------- */
/* Titles                                                                     */
/* -------------------------------------------------------------------------- */

export async function listTitles(): Promise<Title[]> {
  const all = await (await db()).getAll('titles');
  return all.filter((t) => !t.deleted && t.inLibrary);
}

export async function getTitle(id: string) {
  const t = await (await db()).get('titles', id);
  return t && !t.deleted ? t : undefined;
}

export async function saveTitle(t: Title, { sync = true } = {}) {
  const next = { ...t, updatedAt: sync ? now() : t.updatedAt };
  await (await db()).put('titles', next);
  if (sync) await queueChange('titles', next.id, syncableTitle(next));
  dataEvents.emit('titles');
  return next;
}

export async function updateTitle(id: string, patch: Partial<Title>) {
  const t = await getTitle(id);
  if (!t) throw new Error('Title not found');
  return saveTitle({ ...t, ...patch, id });
}

export const setStatus = (id: string, status: ReadingStatus) => updateTitle(id, { status });
export const toggleFavorite = async (id: string) => {
  const t = await getTitle(id);
  if (t) await updateTitle(id, { favorite: !t.favorite });
};

/** Remove a title, its chapters, files, progress and downloads from this device. */
export async function deleteTitle(id: string) {
  const d = await db();
  const t = await d.get('titles', id);
  if (!t) return;
  const chapters = await d.getAllFromIndex('chapters', 'byTitle', id);
  const tx = d.transaction(['titles', 'chapters', 'files', 'progress', 'offline', 'downloads'], 'readwrite');
  for (const c of chapters) {
    if (c.fileId) await tx.objectStore('files').delete(c.fileId);
    await tx.objectStore('chapters').put({ ...c, deleted: true, fileId: undefined, updatedAt: now() });
    await tx.objectStore('progress').delete(c.id);
    await tx.objectStore('offline').delete(c.id);
  }
  for (const dl of await tx.objectStore('downloads').getAll()) if (dl.titleId === id) await tx.objectStore('downloads').delete(dl.id);
  if (t.cover.startsWith('file:')) await tx.objectStore('files').delete(t.cover.slice(5));
  await tx.objectStore('titles').put({ ...t, deleted: true, inLibrary: false, cover: '', updatedAt: now() });
  await tx.done;
  await queueChange('titles', id, null, 'delete');
  dataEvents.emit('titles');
  dataEvents.emit('chapters');
}

/* -------------------------------------------------------------------------- */
/* Chapters                                                                   */
/* -------------------------------------------------------------------------- */

export async function listChapters(titleId: string): Promise<Chapter[]> {
  const list = await (await db()).getAllFromIndex('chapters', 'byTitle', titleId);
  return list
    .filter((c) => !c.deleted)
    .sort((a, b) => (a.volume ?? 0) - (b.volume ?? 0) || a.number - b.number || naturalCompare(a.name, b.name));
}

export async function getChapter(id: string) {
  const c = await (await db()).get('chapters', id);
  return c && !c.deleted ? c : undefined;
}

export async function saveChapter(c: Chapter, { sync = true } = {}) {
  const next = { ...c, updatedAt: now() };
  await (await db()).put('chapters', next);
  if (sync) await queueChange('chapters', next.id, syncableChapter(next));
  dataEvents.emit('chapters');
  return next;
}

export async function deleteChapter(id: string) {
  const d = await db();
  const c = await d.get('chapters', id);
  if (!c) return;
  if (c.fileId) await d.delete('files', c.fileId);
  await d.delete('offline', id);
  await d.delete('progress', id);
  await d.put('chapters', { ...c, deleted: true, fileId: undefined, updatedAt: now() });
  await queueChange('chapters', id, null, 'delete');
  dataEvents.emit('chapters');
}

/* -------------------------------------------------------------------------- */
/* Collections                                                                */
/* -------------------------------------------------------------------------- */

export async function listCollections(): Promise<Collection[]> {
  return (await (await db()).getAll('collections')).filter((c) => !c.deleted).sort((a, b) => a.createdAt - b.createdAt);
}
export async function createCollection(name: string) {
  const clean = name.trim().slice(0, 60);
  if (!clean) throw new Error('Collection name is required');
  const c: Collection = { id: uid(), name: clean, createdAt: now(), updatedAt: now() };
  await (await db()).put('collections', c);
  await queueChange('collections', c.id, c);
  dataEvents.emit('collections');
  return c;
}
export async function renameCollection(id: string, name: string) {
  const d = await db();
  const c = await d.get('collections', id);
  if (!c) return;
  const next = { ...c, name: name.trim().slice(0, 60) || c.name, updatedAt: now() };
  await d.put('collections', next);
  await queueChange('collections', id, next);
  dataEvents.emit('collections');
}
export async function deleteCollection(id: string) {
  const d = await db();
  const c = await d.get('collections', id);
  if (!c) return;
  await d.put('collections', { ...c, deleted: true, updatedAt: now() });
  for (const t of await listTitles()) {
    if (t.collectionIds.includes(id)) await updateTitle(t.id, { collectionIds: t.collectionIds.filter((x) => x !== id) });
  }
  await queueChange('collections', id, null, 'delete');
  dataEvents.emit('collections');
}

/* -------------------------------------------------------------------------- */
/* Covers                                                                     */
/* -------------------------------------------------------------------------- */

async function makeThumbnail(blob: Blob, maxW = 480): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, maxW / bmp.width);
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
    return await new Promise((res) => c.toBlob((b) => res(b ?? blob), 'image/webp', 0.85));
  } catch {
    return blob;
  }
}

export async function setCoverFromBlob(titleId: string, blob: Blob) {
  const thumb = await makeThumbnail(blob);
  const id = `cover-${titleId}`;
  const rec: FileRecord = { id, name: 'cover', size: thumb.size, mime: thumb.type, fingerprint: '', blob: thumb, createdAt: now() };
  await (await db()).put('files', rec);
  await updateTitle(titleId, { cover: `file:${id}` });
}

/** Use page `pageIndex` of a chapter as the title cover. */
export async function setCoverFromPage(titleId: string, chapter: Chapter, pageIndex: number) {
  if (!chapter.fileId) throw new Error('Only local chapters can provide a cover page.');
  const f = await (await db()).get('files', chapter.fileId);
  if (!f) throw new Error('Chapter file missing.');
  const src = await openSource(chapter.format, f.blob, f.parts, f.partNames);
  try {
    const page = await src.load(Math.min(pageIndex, src.count - 1));
    if (page.kind !== 'image') throw new Error('That page is not an image.');
    const blob = await (await fetch(page.url)).blob();
    page.revoke?.();
    await setCoverFromBlob(titleId, blob);
  } finally {
    src.dispose();
  }
}

export async function getFileBlob(id: string) {
  return (await (await db()).get('files', id))?.blob;
}

/* -------------------------------------------------------------------------- */
/* Import                                                                     */
/* -------------------------------------------------------------------------- */

export interface ImportResult {
  added: { titleId: string; chapterId: string; name: string }[];
  duplicates: string[];
  errors: { name: string; message: string }[];
}

const MAX_IMPORT_BYTES = 2 * 1024 * 1024 * 1024;

/**
 * Import user files. Archives/PDF/EPUB become one chapter each; loose images
 * become a single chapter (ordered naturally). Files are grouped into series
 * by their parsed name unless `intoTitleId` is given. Imported content is only
 * ever decoded as images/HTML — never executed.
 */
export async function importFiles(
  files: File[],
  opts: { intoTitleId?: string; onProgress?: (done: number, total: number, name: string) => void } = {},
): Promise<ImportResult> {
  const d = await db();
  const res: ImportResult = { added: [], duplicates: [], errors: [] };
  const images: File[] = [];
  const docs: { file: File; format: ContentFormat }[] = [];

  for (const f of files) {
    if (f.size > MAX_IMPORT_BYTES) {
      res.errors.push({ name: f.name, message: 'File is larger than 2 GB.' });
      continue;
    }
    const fmt = await sniffFormat(f, f.name);
    if (!fmt) res.errors.push({ name: f.name, message: 'Unsupported or unrecognised file type.' });
    else if (fmt === 'images') images.push(f);
    else docs.push({ file: f, format: fmt });
  }

  const existing = await listTitles();
  const byNorm = new Map(existing.map((t) => [normalizeTitle(t.title), t]));
  const touched = new Set<string>();
  const total = docs.length + (images.length ? 1 : 0);
  let done = 0;

  const ensureTitle = async (series: string, meta?: Partial<Title>): Promise<Title> => {
    if (opts.intoTitleId) {
      const t = await getTitle(opts.intoTitleId);
      if (t) return t;
    }
    const key = normalizeTitle(series);
    const hit = byNorm.get(key);
    if (hit) return hit;
    const t = await saveTitle(newTitle({ title: series, status: 'plan_to_read', ...meta }));
    byNorm.set(key, t);
    return t;
  };

  const addChapter = async (title: Title, rec: FileRecord, format: ContentFormat, label: string, number: number, volume?: number) => {
    // validate by actually opening it — catches corrupt / disguised files before they enter the library
    const src = await openSource(format, rec.blob, rec.parts, rec.partNames);
    const pageCount = src.count;
    src.dispose();
    await d.put('files', rec);
    const ch = await saveChapter({
      id: uid(),
      titleId: title.id,
      name: label,
      number,
      volume,
      format,
      fileId: rec.id,
      pageCount,
      addedAt: now(),
      updatedAt: now(),
    });
    touched.add(title.id);
    res.added.push({ titleId: title.id, chapterId: ch.id, name: rec.name });
    return ch;
  };

  for (const { file, format } of docs) {
    opts.onProgress?.(done, total, file.name);
    try {
      const fp = await fingerprintBlob(file);
      if (await d.getFromIndex('files', 'byFingerprint', fp)) {
        res.duplicates.push(file.name);
        continue;
      }
      const parsed = parseFileName(file.name);
      let meta: Partial<Title> | undefined;
      let series = parsed.series;
      if (format === 'epub') {
        const ep = await EpubSource.open(file);
        meta = { authors: ep.meta.creators, description: ep.meta.description ?? '', genres: ep.meta.subjects.slice(0, 8) };
        if (ep.meta.title && parsed.chapter < 0) series = ep.meta.title;
      }
      const title = await ensureTitle(series, meta);
      const rec: FileRecord = { id: uid(), name: file.name, size: file.size, mime: file.type, fingerprint: fp, blob: file, createdAt: now() };
      await addChapter(title, rec, format, parsed.chapter < 0 && format === 'epub' ? series : parsed.label, parsed.chapter, parsed.volume);
    } catch (e) {
      res.errors.push({ name: file.name, message: e instanceof Error ? e.message : String(e) });
    }
    done++;
  }

  if (images.length) {
    opts.onProgress?.(done, total, `${images.length} images`);
    try {
      const sorted = [...images].filter((f) => isImageName(f.name)).sort((a, b) => naturalCompare(a.webkitRelativePath || a.name, b.webkitRelativePath || b.name));
      const folder = sorted[0].webkitRelativePath?.split('/').slice(-2, -1)[0];
      const parsed = parseFileName(folder || sorted[0].name);
      const series = folder ? parsed.series : parsed.series.replace(/\s*\d+$/, '') || 'Imported images';
      const fpParts = await Promise.all(sorted.slice(0, 3).map(fingerprintBlob));
      const fp = `imgs:${sorted.length}:${fpParts.join('')}`;
      if (await d.getFromIndex('files', 'byFingerprint', fp)) {
        res.duplicates.push(`${sorted.length} images`);
      } else {
        const title = await ensureTitle(series);
        const rec: FileRecord = {
          id: uid(),
          name: folder || sorted[0].name,
          size: sorted.reduce((s, f) => s + f.size, 0),
          mime: 'image/*',
          fingerprint: fp,
          blob: new Blob([]),
          parts: sorted,
          partNames: sorted.map((f) => f.name),
          createdAt: now(),
        };
        await addChapter(title, rec, 'images', folder ? parsed.label : `Images (${sorted.length})`, parsed.chapter, parsed.volume);
      }
    } catch (e) {
      res.errors.push({ name: 'images', message: e instanceof Error ? e.message : String(e) });
    }
    done++;
  }

  // Auto-cover for titles that have none
  for (const id of touched) {
    const t = await getTitle(id);
    if (!t || t.cover) continue;
    const first = (await listChapters(id))[0];
    if (first) {
      try {
        if (first.format === 'epub' && first.fileId) {
          const ep = await EpubSource.open((await getFileBlob(first.fileId))!);
          const cb = await ep.coverBlob();
          if (cb) {
            await setCoverFromBlob(id, cb);
            continue;
          }
        }
        await setCoverFromPage(id, first, 0);
      } catch (e) {
        console.warn('[import] cover extraction failed', e);
      }
    }
  }
  opts.onProgress?.(total, total, '');
  return res;
}

/* -------------------------------------------------------------------------- */
/* Duplicates                                                                 */
/* -------------------------------------------------------------------------- */

/** Groups of library titles that look like the same series. */
export async function findDuplicateTitles(): Promise<Title[][]> {
  const groups = new Map<string, Title[]>();
  for (const t of await listTitles()) {
    const keys = [t.title, ...t.altTitles].map(normalizeTitle).filter(Boolean);
    const k = keys[0];
    if (!k) continue;
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

/** Merge `fromId` into `intoId`: chapters move over, metadata gaps are filled. */
export async function mergeTitles(intoId: string, fromId: string) {
  const into = await getTitle(intoId);
  const from = await getTitle(fromId);
  if (!into || !from || into.id === from.id) return;
  for (const c of await listChapters(fromId)) await saveChapter({ ...c, titleId: intoId });
  const d = await db();
  for (const p of await d.getAllFromIndex('progress', 'byTitle', fromId)) await d.put('progress', { ...p, titleId: intoId });
  await updateTitle(intoId, {
    altTitles: [...new Set([...into.altTitles, from.title, ...from.altTitles])].filter((x) => x !== into.title),
    authors: into.authors.length ? into.authors : from.authors,
    description: into.description || from.description,
    genres: [...new Set([...into.genres, ...from.genres])],
    cover: into.cover || from.cover,
    favorite: into.favorite || from.favorite,
    collectionIds: [...new Set([...into.collectionIds, ...from.collectionIds])],
  });
  if (into.cover && from.cover.startsWith('file:') && from.cover !== into.cover) await d.delete('files', from.cover.slice(5));
  await d.put('titles', { ...from, deleted: true, inLibrary: false, cover: '', updatedAt: now() });
  await queueChange('titles', fromId, null, 'delete');
  dataEvents.emit('titles');
}
