import type { ContentFormat, LoadedPage, PageSource } from '../types';
import { isImageName, mimeForImage, naturalCompare } from '../util';
import { ArchiveError, ZipReader, type ZipEntry } from './zip';

/* -------------------------------------------------------------------------- */
/* Format detection & validation                                              */
/* -------------------------------------------------------------------------- */

export async function sniffFormat(blob: Blob, name: string): Promise<ContentFormat | null> {
  const head = new Uint8Array(await blob.slice(0, 64).arrayBuffer());
  const ascii = String.fromCharCode(...head);
  const ext = name.split('.').pop()?.toLowerCase();
  if (head[0] === 0x50 && head[1] === 0x4b) {
    if (ext === 'epub' || ascii.includes('application/epub+zip')) return 'epub';
    return ext === 'zip' ? 'zip' : 'cbz';
  }
  if (ascii.startsWith('Rar!\x1a\x07')) return 'cbr';
  if (ascii.startsWith('%PDF-')) return 'pdf';
  if (isImageName(name) && looksLikeImage(head)) return 'images';
  return null;
}

function looksLikeImage(h: Uint8Array): boolean {
  const s = String.fromCharCode(...h.slice(0, 12));
  return (
    (h[0] === 0xff && h[1] === 0xd8) || // jpeg
    s.startsWith('\x89PNG') ||
    s.startsWith('GIF8') ||
    (s.startsWith('RIFF') && s.slice(8, 12) === 'WEBP') ||
    s.slice(4, 12).includes('ftypavi') ||
    s.startsWith('BM') ||
    (h[0] === 0xff && h[1] === 0x0a) // jxl codestream
  );
}

/* -------------------------------------------------------------------------- */
/* Image helpers                                                              */
/* -------------------------------------------------------------------------- */

function imagePage(bytes: Uint8Array | Blob, name: string): LoadedPage {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes as BlobPart], { type: mimeForImage(name) });
  const url = URL.createObjectURL(blob);
  return { kind: 'image', url, revoke: () => URL.revokeObjectURL(url) };
}

function aborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
}

/* -------------------------------------------------------------------------- */
/* Image list (loose images, folders)                                         */
/* -------------------------------------------------------------------------- */

export class ImageListSource implements PageSource {
  readonly names: string[];
  constructor(private parts: Blob[], names: string[]) {
    this.names = names;
  }
  get count() {
    return this.parts.length;
  }
  async load(i: number) {
    return imagePage(this.parts[i], this.names[i]);
  }
  dispose() {}
}

/* -------------------------------------------------------------------------- */
/* ZIP / CBZ                                                                  */
/* -------------------------------------------------------------------------- */

export class ZipImageSource implements PageSource {
  private constructor(
    private zip: ZipReader,
    private pages: ZipEntry[],
  ) {}
  static async open(blob: Blob) {
    const zip = await ZipReader.open(blob);
    const pages = zip.entries.filter((e) => isImageName(e.name)).sort((a, b) => naturalCompare(a.name, b.name));
    if (!pages.length) throw new ArchiveError('No images were found in this archive.');
    return new ZipImageSource(zip, pages);
  }
  get count() {
    return this.pages.length;
  }
  get names() {
    return this.pages.map((p) => p.name.split('/').pop()!);
  }
  async load(i: number, signal?: AbortSignal) {
    aborted(signal);
    const e = this.pages[i];
    const data = await this.zip.read(e);
    aborted(signal);
    return imagePage(data, e.name);
  }
  dispose() {}
}

/* -------------------------------------------------------------------------- */
/* RAR / CBR (WebAssembly unrar — never executes archive contents)            */
/* -------------------------------------------------------------------------- */

let wasmBinary: Promise<ArrayBuffer> | null = null;
async function unrarWasm() {
  if (!wasmBinary) {
    wasmBinary = import('node-unrar-js/esm/js/unrar.wasm?url').then(async (m) => {
      const r = await fetch(m.default);
      if (!r.ok) throw new ArchiveError('Could not load the RAR decoder.');
      return r.arrayBuffer();
    });
  }
  return wasmBinary;
}

export class RarImageSource implements PageSource {
  private constructor(
    private data: ArrayBuffer,
    private files: string[],
  ) {}
  static async open(blob: Blob) {
    const { createExtractorFromData } = await import('node-unrar-js');
    const data = await blob.arrayBuffer();
    const ex = await createExtractorFromData({ wasmBinary: await unrarWasm(), data });
    const list = ex.getFileList();
    if (list.arcHeader.flags.headerEncrypted) throw new ArchiveError('Password-protected RAR archives are not supported.');
    const files = [...list.fileHeaders]
      .filter((h) => !h.flags.directory && isImageName(h.name))
      .map((h) => h.name)
      .sort(naturalCompare);
    if (!files.length) throw new ArchiveError('No images were found in this archive.');
    return new RarImageSource(data, files);
  }
  get count() {
    return this.files.length;
  }
  get names() {
    return this.files.map((f) => f.split(/[\\/]/).pop()!);
  }
  async load(i: number, signal?: AbortSignal) {
    aborted(signal);
    const { createExtractorFromData } = await import('node-unrar-js');
    const ex = await createExtractorFromData({ wasmBinary: await unrarWasm(), data: this.data });
    const out = ex.extract({ files: [this.files[i]] });
    for (const f of out.files) {
      if (f.extraction) return imagePage(f.extraction, f.fileHeader.name);
    }
    throw new ArchiveError(`Could not extract page ${i + 1}.`);
  }
  dispose() {}
}

/* -------------------------------------------------------------------------- */
/* PDF (pdf.js, rendered lazily to bitmaps)                                   */
/* -------------------------------------------------------------------------- */

type PdfDoc = import('pdfjs-dist').PDFDocumentProxy;
let pdfjs: Promise<typeof import('pdfjs-dist')> | null = null;
async function loadPdfJs() {
  if (!pdfjs) {
    pdfjs = Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]).then(([lib, worker]) => {
      lib.GlobalWorkerOptions.workerSrc = worker.default;
      return lib;
    });
  }
  return pdfjs;
}

export class PdfSource implements PageSource {
  private constructor(private doc: PdfDoc) {}
  static async open(blob: Blob) {
    const lib = await loadPdfJs();
    const doc = await lib.getDocument({
      data: new Uint8Array(await blob.arrayBuffer()),
      isEvalSupported: false, // never evaluate PDF-supplied code
      enableXfa: false,
    }).promise;
    return new PdfSource(doc);
  }
  get count() {
    return this.doc.numPages;
  }
  async load(i: number, signal?: AbortSignal) {
    aborted(signal);
    const page = await this.doc.getPage(i + 1);
    const base = page.getViewport({ scale: 1 });
    const target = Math.min(2400, Math.max(1200, (globalThis.innerWidth || 1200) * (globalThis.devicePixelRatio || 1)));
    const scale = Math.min(4, target / base.width);
    const vp = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(vp.width);
    canvas.height = Math.ceil(vp.height);
    const ctx = canvas.getContext('2d')!;
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    page.cleanup();
    aborted(signal);
    const blob: Blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('render failed'))), 'image/webp', 0.9));
    canvas.width = canvas.height = 0;
    const url = URL.createObjectURL(blob);
    return { kind: 'image' as const, url, width: vp.width, height: vp.height, revoke: () => URL.revokeObjectURL(url) };
  }
  dispose() {
    void this.doc.destroy();
  }
}

/* -------------------------------------------------------------------------- */
/* EPUB (fixed-layout comics → images; reflowable → sanitised HTML)           */
/* -------------------------------------------------------------------------- */

const xml = (s: string) => new DOMParser().parseFromString(s, 'application/xml');
const resolvePath = (base: string, rel: string) => {
  const parts = (base.includes('/') ? base.slice(0, base.lastIndexOf('/') + 1) + rel : rel).split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p !== '.' && p !== '') out.push(p);
  }
  return decodeURIComponent(out.join('/'));
};

type EpubPage = { type: 'image'; entry: ZipEntry } | { type: 'html'; path: string };

export interface EpubMeta {
  title?: string;
  creators: string[];
  description?: string;
  subjects: string[];
  coverPath?: string;
}

export class EpubSource implements PageSource {
  private constructor(
    private zip: ZipReader,
    private pages: EpubPage[],
    readonly meta: EpubMeta,
  ) {}

  static async open(blob: Blob) {
    const zip = await ZipReader.open(blob);
    const container = await zip.readText('META-INF/container.xml');
    if (!container) throw new ArchiveError('Invalid EPUB: META-INF/container.xml missing.');
    const opfPath = xml(container).querySelector('rootfile')?.getAttribute('full-path');
    if (!opfPath) throw new ArchiveError('Invalid EPUB: no package document.');
    const opfText = await zip.readText(opfPath);
    if (!opfText) throw new ArchiveError('Invalid EPUB: package document missing.');
    const opf = xml(opfText);
    const manifest = new Map<string, { href: string; type: string; props: string }>();
    opf.querySelectorAll('manifest > item').forEach((it) =>
      manifest.set(it.getAttribute('id')!, {
        href: resolvePath(opfPath, it.getAttribute('href') || ''),
        type: it.getAttribute('media-type') || '',
        props: it.getAttribute('properties') || '',
      }),
    );
    const txt = (sel: string) => opf.getElementsByTagNameNS('*', sel);
    const meta: EpubMeta = {
      title: txt('title')[0]?.textContent?.trim() || undefined,
      creators: [...txt('creator')].map((n) => n.textContent!.trim()).filter(Boolean),
      description: txt('description')[0]?.textContent?.replace(/<[^>]+>/g, '').trim() || undefined,
      subjects: [...txt('subject')].map((n) => n.textContent!.trim()).filter(Boolean),
    };
    const coverItem =
      [...manifest.values()].find((m) => m.props.includes('cover-image')) ??
      manifest.get(opf.querySelector('meta[name="cover"]')?.getAttribute('content') || '');
    if (coverItem) meta.coverPath = coverItem.href;

    const spine = [...opf.querySelectorAll('spine > itemref')]
      .map((r) => manifest.get(r.getAttribute('idref') || ''))
      .filter((m): m is NonNullable<typeof m> => !!m);

    const pages: EpubPage[] = [];
    for (const item of spine) {
      if (item.type.startsWith('image/')) {
        const e = zip.find(item.href);
        if (e) pages.push({ type: 'image', entry: e });
        continue;
      }
      const html = await zip.readText(item.href);
      if (!html) continue;
      const doc = new DOMParser().parseFromString(html, item.type.includes('xhtml') ? 'application/xhtml+xml' : 'text/html');
      const imgs = [...doc.querySelectorAll('img[src], image')].map(
        (n) => n.getAttribute('src') || n.getAttribute('xlink:href') || n.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || '',
      );
      const textLen = (doc.body?.textContent || '').replace(/\s+/g, '').length;
      if (imgs.length === 1 && textLen < 40) {
        const e = zip.find(resolvePath(item.href, imgs[0]));
        if (e) {
          pages.push({ type: 'image', entry: e });
          continue;
        }
      }
      pages.push({ type: 'html', path: item.href });
    }
    if (!pages.length) throw new ArchiveError('This EPUB has no readable pages.');
    return new EpubSource(zip, pages, meta);
  }

  get count() {
    return this.pages.length;
  }

  async coverBlob(): Promise<Blob | undefined> {
    if (!this.meta.coverPath) return undefined;
    const e = this.zip.find(this.meta.coverPath);
    if (!e) return undefined;
    return new Blob([(await this.zip.read(e)) as BlobPart], { type: mimeForImage(e.name) });
  }

  async load(i: number, signal?: AbortSignal): Promise<LoadedPage> {
    aborted(signal);
    const p = this.pages[i];
    if (p.type === 'image') return imagePage(await this.zip.read(p.entry), p.entry.name);
    const raw = (await this.zip.readText(p.path)) || '';
    return { kind: 'html', html: await this.sanitize(raw, p.path) };
  }

  /** Strip active content and inline images as data URIs (the page renders in a script-less sandbox). */
  private async sanitize(raw: string, path: string): Promise<string> {
    const doc = new DOMParser().parseFromString(raw, 'text/html');
    doc.querySelectorAll('script,iframe,object,embed,form,link,meta,base,style[src]').forEach((n) => n.remove());
    doc.querySelectorAll('*').forEach((el) => {
      for (const a of [...el.attributes]) {
        if (/^on/i.test(a.name) || /^\s*javascript:/i.test(a.value)) el.removeAttribute(a.name);
      }
    });
    for (const img of [...doc.querySelectorAll('img[src], image')]) {
      const attr = img.hasAttribute('src') ? 'src' : 'xlink:href';
      const src = img.getAttribute(attr) || img.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || '';
      const e = this.zip.find(resolvePath(path, src));
      if (!e || e.size > 8 * 1024 * 1024) {
        img.remove();
        continue;
      }
      const bytes = await this.zip.read(e);
      let bin = '';
      for (let k = 0; k < bytes.length; k += 0x8000) bin += String.fromCharCode(...bytes.subarray(k, k + 0x8000));
      const uri = `data:${mimeForImage(e.name)};base64,${btoa(bin)}`;
      img.setAttribute(attr === 'src' ? 'src' : 'href', uri);
    }
    doc.querySelectorAll('a[href]').forEach((a) => a.removeAttribute('href'));
    return doc.body?.innerHTML ?? '';
  }

  dispose() {}
}

/* -------------------------------------------------------------------------- */

export async function openSource(format: ContentFormat, blob: Blob, parts?: Blob[], partNames?: string[]): Promise<PageSource> {
  switch (format) {
    case 'images':
      return new ImageListSource(parts ?? [blob], partNames ?? ['image']);
    case 'cbz':
    case 'zip':
      return ZipImageSource.open(blob);
    case 'cbr':
      return RarImageSource.open(blob);
    case 'pdf':
      return PdfSource.open(blob);
    case 'epub':
      return EpubSource.open(blob);
    default:
      throw new ArchiveError(`Unsupported format: ${format}`);
  }
}
