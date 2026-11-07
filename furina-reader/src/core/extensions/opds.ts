import type { OpdsCatalog } from '../db';
import type { ChapterInfo, ContentSource, MangaDetails, SearchResult } from './sdk';

/**
 * OPDS 1.2 catalogue client (with OPDS-PSE page streaming).
 * Lets users read from servers they own or are authorised to use —
 * Komga, Kavita, Calibre-Web, Ubooquity, public-domain libraries, etc.
 */

const ATOM = 'http://www.w3.org/2005/Atom';
const PSE = 'http://vaemendis.net/opds-pse/ns';
const ACQ = 'http://opds-spec.org/acquisition';
const READABLE = /(zip|cbz|comicbook|rar|cbr|pdf|epub)/i;

export interface OpdsEntry {
  id: string;
  title: string;
  summary: string;
  authors: string[];
  categories: string[];
  cover?: string;
  /** Navigation link to a sub-feed */
  navigation?: string;
  /** Acquisition link (downloadable file) */
  acquisition?: { href: string; type: string; length?: number };
  /** OPDS-PSE streaming template + page count */
  stream?: { template: string; count: number };
}

export interface OpdsFeed {
  title: string;
  entries: OpdsEntry[];
  next?: string;
  searchTemplate?: string;
  searchDescription?: string;
}

export class OpdsSource implements ContentSource {
  readonly kind = 'opds' as const;
  readonly id: string;
  readonly name: string;
  readonly version = '1.2';
  constructor(
    readonly catalog: OpdsCatalog,
    private fetchImpl: typeof fetch = (...a) => fetch(...a),
  ) {
    this.id = `opds:${catalog.id}`;
    this.name = catalog.name;
  }

  private headers(): HeadersInit {
    const h: Record<string, string> = { Accept: 'application/atom+xml, application/xml;q=0.9, */*;q=0.5' };
    if (this.catalog.username) h.Authorization = 'Basic ' + btoa(`${this.catalog.username}:${this.catalog.password ?? ''}`);
    return h;
  }

  private abs(href: string, base: string) {
    return new URL(href, base).toString();
  }

  async fetchFeed(url: string): Promise<OpdsFeed> {
    const res = await this.fetchImpl(url, { headers: this.headers() });
    if (res.status === 401) throw new Error('The catalogue requires a username and password.');
    if (!res.ok) throw new Error(`Catalogue responded ${res.status}`);
    const text = await res.text();
    return this.parseFeed(text, res.url || url);
  }

  parseFeed(text: string, base: string): OpdsFeed {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('The catalogue returned invalid XML.');
    const feed = doc.documentElement;
    const links = (el: Element) => [...el.getElementsByTagNameNS(ATOM, 'link')].filter((l) => l.parentNode === el);
    const kids = (el: Element, name: string) => [...el.getElementsByTagNameNS(ATOM, name)].filter((n) => n.parentNode === el);
    const out: OpdsFeed = { title: kids(feed, 'title')[0]?.textContent?.trim() || this.name, entries: [] };
    for (const l of links(feed)) {
      const rel = l.getAttribute('rel') || '';
      const href = l.getAttribute('href');
      if (!href) continue;
      if (rel === 'next') out.next = this.abs(href, base);
      if (rel === 'search') {
        const type = l.getAttribute('type') || '';
        if (type.includes('atom') && href.includes('{searchTerms}')) out.searchTemplate = this.abs(href, base).replace('%7BsearchTerms%7D', '{searchTerms}');
        else if (type.includes('opensearchdescription')) out.searchDescription = this.abs(href, base);
      }
    }
    for (const e of kids(feed, 'entry')) {
      const entry: OpdsEntry = {
        id: kids(e, 'id')[0]?.textContent?.trim() || '',
        title: kids(e, 'title')[0]?.textContent?.trim() || 'Untitled',
        summary: (kids(e, 'summary')[0] || kids(e, 'content')[0])?.textContent?.replace(/<[^>]+>/g, '').trim() || '',
        authors: kids(e, 'author').map((a) => a.getElementsByTagNameNS(ATOM, 'name')[0]?.textContent?.trim() || '').filter(Boolean),
        categories: kids(e, 'category').map((c) => c.getAttribute('label') || c.getAttribute('term') || '').filter(Boolean),
      };
      for (const l of links(e)) {
        const rel = l.getAttribute('rel') || '';
        const type = l.getAttribute('type') || '';
        const href = l.getAttribute('href');
        if (!href) continue;
        const url = this.abs(href, base).replace('%7BpageNumber%7D', '{pageNumber}');
        if (rel.includes('image') && !rel.includes('thumbnail')) entry.cover = url;
        else if (rel.includes('thumbnail') && !entry.cover) entry.cover = url;
        else if (rel === 'http://vaemendis.net/opds-pse/stream') {
          const count = Number(l.getAttributeNS(PSE, 'count') || l.getAttribute('pse:count') || 0);
          if (count > 0) entry.stream = { template: url, count };
        } else if (rel.startsWith(ACQ) && READABLE.test(type + href)) {
          entry.acquisition = { href: url, type, length: Number(l.getAttribute('length')) || undefined };
        } else if (type.includes('atom+xml') && (rel === 'subsection' || rel === '' || rel.includes('opds-spec.org/sort') || rel === 'alternate')) {
          entry.navigation ??= url;
        }
      }
      out.entries.push(entry);
    }
    return out;
  }

  private async searchTemplate(): Promise<string | undefined> {
    const root = await this.fetchFeed(this.catalog.url);
    if (root.searchTemplate) return root.searchTemplate;
    if (root.searchDescription) {
      const res = await this.fetchImpl(root.searchDescription, { headers: this.headers() });
      const d = new DOMParser().parseFromString(await res.text(), 'application/xml');
      const u = [...d.getElementsByTagName('Url')].find((x) => (x.getAttribute('type') || '').includes('atom'));
      const tpl = u?.getAttribute('template');
      if (tpl) return this.abs(tpl, root.searchDescription);
    }
    return undefined;
  }

  async search(query: string, page: number): Promise<SearchResult> {
    const tpl = await this.searchTemplate();
    if (!tpl) throw new Error('This catalogue does not support search.');
    const feed = await this.fetchFeed(tpl.replace('{searchTerms}', encodeURIComponent(query)).replace('{startPage?}', String(page)).replace(/\{[^}]+\?\}/g, ''));
    return {
      results: feed.entries.map((e) => ({ key: e.navigation || e.acquisition?.href || e.id, title: e.title, cover: e.cover, subtitle: e.authors.join(', ') })),
      hasMore: !!feed.next,
    };
  }

  /** key = sub-feed URL (series) or acquisition URL (single book) */
  async details(key: string): Promise<MangaDetails> {
    if (!/atom|opds|xml|\/opds\//i.test(key) && /\.(cbz|cbr|zip|pdf|epub)(\?|$)/i.test(key)) return { key, title: decodeURIComponent(key.split('/').pop() || 'Book') };
    const feed = await this.fetchFeed(key);
    const first = feed.entries[0];
    return {
      key,
      title: feed.title,
      cover: first?.cover,
      authors: [...new Set(feed.entries.flatMap((e) => e.authors))],
      description: first?.summary,
      genres: [...new Set(feed.entries.flatMap((e) => e.categories))].slice(0, 10),
    };
  }

  async chapters(key: string): Promise<ChapterInfo[]> {
    const out: ChapterInfo[] = [];
    let url: string | undefined = key;
    let guard = 0;
    while (url && guard++ < 20) {
      const feed = await this.fetchFeed(url);
      feed.entries.forEach((e) => {
        if (!e.acquisition && !e.stream) return;
        const num = Number(e.title.match(/(\d+(?:\.\d+)?)(?!.*\d)/)?.[1] ?? out.length + 1);
        out.push({ key: JSON.stringify({ a: e.acquisition?.href, s: e.stream }), name: e.title, number: num });
      });
      url = feed.next;
    }
    return out;
  }

  async pages(chapterKey: string) {
    const k = JSON.parse(chapterKey) as { a?: string; s?: { template: string; count: number } };
    if (k.s) {
      // OPDS-PSE: zero-based page numbers
      return { type: 'urls' as const, urls: Array.from({ length: k.s.count }, (_, i) => k.s!.template.replace('{pageNumber}', String(i)).replace(/\{maxWidth\}/, '2000')) };
    }
    if (!k.a) throw new Error('This entry has no readable file.');
    const { blob, name } = await this.download(chapterKey, () => {}, new AbortController().signal);
    return { type: 'archive' as const, blob, name };
  }

  /** Streams the acquisition file with progress; supports resume via HTTP Range when the server allows it. */
  async download(chapterKey: string, onProgress: (r: number, t: number) => void, signal: AbortSignal, resumeFrom?: Blob) {
    const k = JSON.parse(chapterKey) as { a?: string };
    if (!k.a) throw new Error('This entry is stream-only and cannot be downloaded as a file.');
    const headers = new Headers(this.headers());
    if (resumeFrom?.size) headers.set('Range', `bytes=${resumeFrom.size}-`);
    const res = await this.fetchImpl(k.a, { headers, signal });
    if (!res.ok && res.status !== 206) throw new Error(`Download failed (${res.status})`);
    const partial = res.status === 206 && resumeFrom;
    const total = Number(res.headers.get('content-length') || 0) + (partial ? resumeFrom!.size : 0);
    const chunks: BlobPart[] = partial ? [resumeFrom!] : [];
    let received = partial ? resumeFrom!.size : 0;
    const reader = res.body?.getReader();
    if (!reader) {
      const b = await res.blob();
      onProgress(b.size, b.size);
      return { blob: b, name: decodeURIComponent(k.a.split('/').pop()?.split('?')[0] || 'chapter') };
    }
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value as BlobPart);
        received += value.byteLength;
        onProgress(received, total || received);
      }
    } catch (e) {
      // Hand back what we have so a paused download can resume with a Range request.
      throw Object.assign(e instanceof Error ? e : new Error(String(e)), { partial: new Blob(chunks) });
    }
    const cd = res.headers.get('content-disposition')?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)/i)?.[1];
    return { blob: new Blob(chunks), name: decodeURIComponent(cd || k.a.split('/').pop()?.split('?')[0] || 'chapter') };
  }
}
