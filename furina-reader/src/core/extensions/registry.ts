import { dataEvents, db, type InstalledExtension, type OpdsCatalog } from '../db';
import { getFileBlob, getTitle, listChapters, newTitle, saveChapter, saveTitle } from '../library';
import { openSource, sniffFormat } from '../importers/sources';
import type { Chapter, LoadedPage, PageSource, Title } from '../types';
import { now, uid } from '../util';
import { OpdsSource } from './opds';
import { SandboxedExtension } from './sandbox';
import { compareSemver, validateManifest, type ContentSource, type ExtensionPackage, type MangaDetails } from './sdk';

/* -------------------------------------------------------------------------- */
/* Source registry                                                            */
/* -------------------------------------------------------------------------- */

const live = new Map<string, ContentSource>();

export async function listSources(): Promise<ContentSource[]> {
  const d = await db();
  const out: ContentSource[] = [];
  for (const c of await d.getAll('opds')) out.push(getOrCreate(`opds:${c.id}`, () => new OpdsSource(c)));
  for (const e of await d.getAll('extensions')) {
    if (!e.enabled) continue;
    out.push(getOrCreate(`ext:${e.id}`, () => new SandboxedExtension({ manifest: e.manifest as never, code: e.code, config: e.config })));
  }
  return out;
}

function getOrCreate(id: string, make: () => ContentSource) {
  let s = live.get(id);
  if (!s) live.set(id, (s = make()));
  return s;
}

export async function getSource(id: string): Promise<ContentSource | undefined> {
  if (live.has(id)) return live.get(id);
  return (await listSources()).find((s) => s.id === id);
}

function unload(id: string) {
  const s = live.get(id);
  if (s instanceof SandboxedExtension) s.dispose();
  live.delete(id);
}

/* --------------------------------- OPDS ----------------------------------- */

export async function addOpdsCatalog(input: { name: string; url: string; username?: string; password?: string }) {
  let url: URL;
  try {
    url = new URL(input.url.trim());
  } catch {
    throw new Error('Enter a valid catalogue URL.');
  }
  if (!/^https?:$/.test(url.protocol)) throw new Error('Only http(s) catalogues are supported.');
  const cat: OpdsCatalog = { id: uid(), name: input.name.trim() || url.host, url: url.toString(), username: input.username || undefined, password: input.password || undefined, addedAt: now() };
  await new OpdsSource(cat).fetchFeed(cat.url); // verify before saving
  await (await db()).put('opds', cat);
  dataEvents.emit('sources');
  return cat;
}

export async function removeOpdsCatalog(id: string) {
  await (await db()).delete('opds', id);
  unload(`opds:${id}`);
  dataEvents.emit('sources');
}

export const listOpdsCatalogs = async () => (await db()).getAll('opds');

/* ------------------------------ Extensions -------------------------------- */

export function parsePackage(text: string): ExtensionPackage {
  let pkg: unknown;
  try {
    pkg = JSON.parse(text);
  } catch {
    throw new Error('Extension package must be a JSON file (.furina.json).');
  }
  const p = pkg as Partial<ExtensionPackage>;
  if (typeof p.code !== 'string' || !p.code.trim()) throw new Error('Extension package has no code.');
  if (p.code.length > 512 * 1024) throw new Error('Extension code is larger than 512 KB.');
  const v = validateManifest(p.manifest);
  if (!v.ok) throw new Error(v.errors.join(' '));
  return { manifest: v.manifest, code: p.code };
}

export async function installExtension(pkg: ExtensionPackage, sourceUrl?: string): Promise<InstalledExtension> {
  const d = await db();
  const prev = await d.get('extensions', pkg.manifest.id);
  const ext: InstalledExtension = {
    id: pkg.manifest.id,
    name: pkg.manifest.name,
    version: pkg.manifest.version,
    code: pkg.code,
    manifest: pkg.manifest,
    sourceUrl: sourceUrl ?? prev?.sourceUrl,
    enabled: prev?.enabled ?? true,
    installedAt: now(),
    config: prev?.config ?? {},
  };
  await d.put('extensions', ext);
  unload(`ext:${ext.id}`);
  dataEvents.emit('sources');
  return ext;
}

export async function installExtensionFromUrl(url: string) {
  if (!/^https:\/\//.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(url)) throw new Error('Extensions must be installed over https.');
  const res = await fetch(url, { credentials: 'omit' });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  return installExtension(parsePackage(await res.text()), url);
}

export async function setExtensionEnabled(id: string, enabled: boolean) {
  const d = await db();
  const e = await d.get('extensions', id);
  if (!e) return;
  await d.put('extensions', { ...e, enabled });
  if (!enabled) unload(`ext:${id}`);
  dataEvents.emit('sources');
}

export async function setExtensionConfig(id: string, config: Record<string, string>) {
  const d = await db();
  const e = await d.get('extensions', id);
  if (!e) return;
  await d.put('extensions', { ...e, config });
  unload(`ext:${id}`);
  dataEvents.emit('sources');
}

export async function uninstallExtension(id: string) {
  await (await db()).delete('extensions', id);
  unload(`ext:${id}`);
  dataEvents.emit('sources');
}

export const listExtensions = async () => (await db()).getAll('extensions');

export async function checkExtensionUpdate(id: string): Promise<{ current: string; latest?: string; pkg?: ExtensionPackage; error?: string }> {
  const e = await (await db()).get('extensions', id);
  if (!e) throw new Error('Not installed');
  const url = (e.manifest as { updateUrl?: string }).updateUrl || e.sourceUrl;
  if (!url) return { current: e.version, error: 'No update URL declared.' };
  try {
    const res = await fetch(url, { credentials: 'omit', cache: 'no-store' });
    const pkg = parsePackage(await res.text());
    if (pkg.manifest.id !== id) return { current: e.version, error: 'Update package id mismatch.' };
    return { current: e.version, latest: pkg.manifest.version, pkg: compareSemver(pkg.manifest.version, e.version) > 0 ? pkg : undefined };
  } catch (err) {
    return { current: e.version, error: err instanceof Error ? err.message : String(err) };
  }
}

/* -------------------------------------------------------------------------- */
/* Library ↔ remote sources                                                   */
/* -------------------------------------------------------------------------- */

export async function addRemoteTitle(sourceId: string, d: MangaDetails): Promise<Title> {
  const existing = (await (await db()).getAllFromIndex('titles', 'bySource', sourceId)).find((t) => t.sourceKey === d.key && !t.deleted);
  if (existing) return saveTitle({ ...existing, inLibrary: true });
  const t = await saveTitle(
    newTitle({
      title: d.title,
      sourceId,
      sourceKey: d.key,
      altTitles: d.altTitles ?? [],
      authors: d.authors ?? [],
      artists: d.artists ?? [],
      description: d.description ?? '',
      genres: d.genres ?? [],
      cover: d.cover ?? '',
    }),
  );
  await refreshRemoteChapters(t.id, { markNew: false });
  return t;
}

/** Fetch the source's chapter list and add any new chapters. Returns how many were new. */
export async function refreshRemoteChapters(titleId: string, { markNew = true } = {}): Promise<number> {
  const t = await getTitle(titleId);
  if (!t || t.sourceId === 'local') return 0;
  const src = await getSource(t.sourceId);
  if (!src) throw new Error('The source for this title is no longer installed.');
  const remote = await src.chapters(t.sourceKey);
  const have = new Set((await listChapters(titleId)).map((c) => c.sourceKey));
  let added = 0;
  for (const r of remote) {
    if (have.has(r.key)) continue;
    await saveChapter({ id: uid(), titleId, name: r.name, number: r.number, volume: r.volume, format: 'remote', sourceKey: r.key, addedAt: r.date ?? now(), updatedAt: now(), isNew: markNew });
    added++;
  }
  return added;
}

/** Check every remote title in the library for new chapters. */
export async function checkAllUpdates(onEach?: (t: Title, added: number, error?: string) => void) {
  const titles = (await (await db()).getAll('titles')).filter((t) => t.inLibrary && !t.deleted && t.sourceId !== 'local');
  let total = 0;
  for (const t of titles) {
    try {
      const n = await refreshRemoteChapters(t.id);
      total += n;
      onEach?.(t, n);
    } catch (e) {
      onEach?.(t, 0, e instanceof Error ? e.message : String(e));
    }
  }
  return total;
}

/* -------------------------------------------------------------------------- */
/* Opening a chapter → PageSource                                             */
/* -------------------------------------------------------------------------- */

class UrlPageSource implements PageSource {
  constructor(readonly urls: string[]) {}
  get count() {
    return this.urls.length;
  }
  async load(i: number): Promise<LoadedPage> {
    return { kind: 'image', url: this.urls[i] };
  }
  dispose() {}
}

export async function openChapter(chapter: Chapter): Promise<PageSource> {
  const d = await db();
  if (chapter.fileId) {
    const f = await d.get('files', chapter.fileId);
    if (!f) throw new Error('The file for this chapter is missing from this device. Re-import it to read.');
    return openSource(chapter.format, f.blob, f.parts, f.partNames);
  }
  const offline = await d.get('offline', chapter.id);
  if (offline) {
    const fmt = (await sniffFormat(offline.blob, offline.name)) ?? 'cbz';
    return openSource(fmt, offline.blob);
  }
  const title = await getTitle(chapter.titleId);
  if (!title || !chapter.sourceKey) throw new Error('This chapter has no content on this device.');
  if (!navigator.onLine) throw new Error('You are offline and this chapter has not been downloaded.');
  const src = await getSource(title.sourceId);
  if (!src) throw new Error('The source for this title is not installed on this device.');
  const pages = await src.pages(chapter.sourceKey);
  if (pages.type === 'urls') return new UrlPageSource(pages.urls);
  const fmt = (await sniffFormat(pages.blob, pages.name)) ?? 'cbz';
  return openSource(fmt, pages.blob);
}

export { getFileBlob };
