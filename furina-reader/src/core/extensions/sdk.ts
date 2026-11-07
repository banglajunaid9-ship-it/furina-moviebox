/**
 * Furina Extension SDK v1 — the contract every content source implements.
 * See docs/EXTENSION_SDK.md for the authoring guide.
 */
export const SDK_VERSION = 1;

export interface ExtensionManifest {
  /** Reverse-DNS id, e.g. "dev.example.mysource" */
  id: string;
  name: string;
  /** semver */
  version: string;
  /** SDK major version this extension targets */
  sdk: number;
  lang: string;
  description?: string;
  author?: string;
  homepage?: string;
  /** URL of the latest `.furina.json` package, for update checks */
  updateUrl?: string;
  /** Hosts the extension may contact through host.fetch (and load images from). "*.example.com" allowed. */
  permissions: { hosts: string[] };
  /** User-editable settings exposed in Extensions → Configure */
  settings?: { key: string; label: string; type: 'text' | 'password' | 'url'; required?: boolean }[];
  /** Extensions must state that they only access content the user is authorised to read. */
  contentPolicy: 'user-authorized';
}

export interface ExtensionPackage {
  manifest: ExtensionManifest;
  code: string;
}

export interface MangaSummary {
  key: string;
  title: string;
  cover?: string;
  subtitle?: string;
}

export interface MangaDetails extends MangaSummary {
  altTitles?: string[];
  authors?: string[];
  artists?: string[];
  description?: string;
  genres?: string[];
  status?: string;
}

export interface ChapterInfo {
  key: string;
  name: string;
  number: number;
  volume?: number;
  date?: number;
}

export interface SearchResult {
  results: MangaSummary[];
  hasMore: boolean;
}

/** Common interface implemented by built-in sources and sandboxed extensions. */
export interface ContentSource {
  id: string;
  name: string;
  kind: 'local' | 'opds' | 'extension';
  version: string;
  icon?: string;
  search(query: string, page: number): Promise<SearchResult>;
  details(key: string): Promise<MangaDetails>;
  chapters(key: string): Promise<ChapterInfo[]>;
  /** Image URLs for streamed reading, or an archive blob for download-to-read sources. */
  pages(chapterKey: string): Promise<{ type: 'urls'; urls: string[] } | { type: 'archive'; blob: Blob; name: string }>;
  /** Download chapter content for offline use. */
  download?(chapterKey: string, onProgress: (received: number, total: number) => void, signal: AbortSignal): Promise<{ blob: Blob; name: string }>;
}

/* ---------------------------- validation ---------------------------------- */

const SEMVER = /^\d+\.\d+\.\d+(?:[-+][\w.]+)?$/;
const HOST = /^(\*\.)?([a-z0-9-]+\.)*[a-z0-9-]+(:\d+)?$/i;

export function validateManifest(m: unknown): { ok: true; manifest: ExtensionManifest } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const x = m as Partial<ExtensionManifest>;
  if (!x || typeof x !== 'object') return { ok: false, errors: ['Manifest must be an object.'] };
  if (!x.id || !/^[a-z0-9]+(\.[a-z0-9-]+)+$/i.test(x.id)) errors.push('id must be reverse-DNS, e.g. "dev.example.source".');
  if (!x.name || typeof x.name !== 'string' || x.name.length > 60) errors.push('name is required (≤ 60 chars).');
  if (!x.version || !SEMVER.test(x.version)) errors.push('version must be semver (1.2.3).');
  if (x.sdk !== SDK_VERSION) errors.push(`Incompatible SDK version ${x.sdk}; this app supports SDK ${SDK_VERSION}.`);
  if (!x.permissions || !Array.isArray(x.permissions.hosts)) errors.push('permissions.hosts must be an array.');
  else if (x.permissions.hosts.some((h) => typeof h !== 'string' || !HOST.test(h) || h === '*')) errors.push('permissions.hosts contains an invalid host (wildcard "*" alone is not allowed).');
  if (x.contentPolicy !== 'user-authorized') errors.push('contentPolicy must be "user-authorized".');
  if (x.updateUrl && !/^https:\/\//.test(x.updateUrl)) errors.push('updateUrl must be https.');
  return errors.length ? { ok: false, errors } : { ok: true, manifest: x as ExtensionManifest };
}

export function compareSemver(a: string, b: string): number {
  const pa = a.split(/[-+]/)[0].split('.').map(Number);
  const pb = b.split(/[-+]/)[0].split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

export function hostAllowed(url: string, hosts: string[]): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) return false;
  const h = u.port ? `${u.hostname}:${u.port}` : u.hostname;
  return hosts.some((p) => {
    const pat = p.toLowerCase();
    if (pat.startsWith('*.')) {
      const base = pat.slice(2);
      return h === base || h.endsWith('.' + base) || u.hostname.endsWith('.' + base);
    }
    return h === pat || u.hostname === pat;
  });
}
