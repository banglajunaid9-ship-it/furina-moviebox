export const uid = (): string =>
  (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

export const now = () => Date.now();

/** Natural sort ("page2" < "page10"). */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
export const naturalCompare = (a: string, b: string) => collator.compare(a, b);

export const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif|bmp|jxl)$/i;
export const isImageName = (n: string) => IMAGE_EXT.test(n) && !/(^|\/)(__MACOSX|\.)/.test(n);

export function mimeForImage(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'avif':
      return 'image/avif';
    case 'bmp':
      return 'image/bmp';
    case 'jxl':
      return 'image/jxl';
    default:
      return 'application/octet-stream';
  }
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}

export function formatDuration(ms: number): string {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}

export function timeAgo(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(ts).toLocaleDateString();
}

export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined;
  const d = (...a: A) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
  d.flush = (...a: A) => {
    clearTimeout(t);
    fn(...a);
  };
  return d;
}

export async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', data as BufferSource);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Cheap, stable fingerprint for duplicate detection without hashing whole files. */
export async function fingerprintBlob(blob: Blob): Promise<string> {
  const CH = 256 * 1024;
  const head = new Uint8Array(await blob.slice(0, CH).arrayBuffer());
  const tail = new Uint8Array(await blob.slice(Math.max(0, blob.size - CH)).arrayBuffer());
  const sizeBytes = new TextEncoder().encode(String(blob.size));
  const all = new Uint8Array(sizeBytes.length + head.length + tail.length);
  all.set(sizeBytes, 0);
  all.set(head, sizeBytes.length);
  all.set(tail, sizeBytes.length + head.length);
  return sha256Hex(all);
}

/** Normalise a title for duplicate comparison. */
export function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Infer series name, volume and chapter number from a file name such as
 * "One Piece v01 c003 [Group].cbz" or "Solo_Leveling_Ch_12.pdf".
 */
export function parseFileName(fileName: string): { series: string; chapter: number; volume?: number; label: string } {
  const base = fileName.replace(/\.[a-z0-9]+$/i, '');
  const cleaned = base
    .replace(/[_]+/g, ' ')
    .replace(/\[[^\]]*\]|\([^)]*\)|\{[^}]*\}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const vol = cleaned.match(/\b(?:v|vol\.?|volume)\s*(\d+(?:\.\d+)?)/i);
  const ch = cleaned.match(/\b(?:c|ch\.?|chap\.?|chapter|ep\.?|episode|#)\s*(\d+(?:\.\d+)?)/i);
  let chapter = ch ? parseFloat(ch[1]) : NaN;
  let seriesEnd = Math.min(...[vol?.index, ch?.index].filter((x): x is number => typeof x === 'number'), cleaned.length);
  if (Number.isNaN(chapter)) {
    // trailing number: "Berserk 012"
    const trail = cleaned.match(/^(.*?)[\s\-–]+(\d+(?:\.\d+)?)\s*$/);
    if (trail && trail[1].trim()) {
      chapter = parseFloat(trail[2]);
      seriesEnd = Math.min(seriesEnd, trail[1].length);
    }
  }
  const series = cleaned.slice(0, seriesEnd).replace(/[\s\-–:]+$/, '').trim() || cleaned || base;
  const volume = vol ? parseFloat(vol[1]) : undefined;
  const label = !Number.isNaN(chapter)
    ? `${volume !== undefined ? `Vol. ${volume} ` : ''}Chapter ${chapter}`
    : volume !== undefined
      ? `Volume ${volume}`
      : base;
  return { series, chapter: Number.isNaN(chapter) ? (volume ?? -1) : chapter, volume, label };
}

export function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}
