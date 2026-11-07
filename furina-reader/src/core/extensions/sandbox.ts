import type { ChapterInfo, ContentSource, ExtensionManifest, MangaDetails, SearchResult } from './sdk';
import { hostAllowed } from './sdk';

/**
 * Runs untrusted extension code in an opaque-origin iframe:
 *  - sandbox="allow-scripts" (no same-origin → no access to app storage, cookies or DOM)
 *  - CSP default-src 'none' → the extension cannot open network connections itself
 *  - every request goes through host.fetch, which enforces the manifest host allow-list,
 *    a rate limit, a response-size cap and a timeout.
 */

const RUNTIME = `
(() => {
  const pending = new Map(); let seq = 0; let source = null;
  const call = (method, args) => new Promise((resolve, reject) => {
    const id = ++seq; pending.set(id, { resolve, reject });
    parent.postMessage({ __furina: 'host-call', id, method, args }, '*');
  });
  const host = Object.freeze({
    fetch: (url, init) => call('fetch', [String(url), init || {}]),
    log: (...a) => call('log', a.map(String)),
    config: Object.freeze(JSON.parse(document.getElementById('cfg').textContent || '{}')),
  });
  Object.defineProperty(self, 'host', { value: host });
  self.registerSource = (impl) => { source = impl; };
  addEventListener('message', async (ev) => {
    const m = ev.data; if (!m || ev.source !== parent) return;
    if (m.__furina === 'host-reply') { const p = pending.get(m.id); if (!p) return; pending.delete(m.id); m.error ? p.reject(new Error(m.error)) : p.resolve(m.result); return; }
    if (m.__furina === 'invoke') {
      try {
        if (!source || typeof source[m.method] !== 'function') throw new Error('Extension does not implement ' + m.method);
        const result = await source[m.method](...m.args);
        parent.postMessage({ __furina: 'invoke-reply', id: m.id, result: JSON.parse(JSON.stringify(result ?? null)) }, '*');
      } catch (e) { parent.postMessage({ __furina: 'invoke-reply', id: m.id, error: String(e && e.message || e) }, '*'); }
    }
  });
  parent.postMessage({ __furina: 'ready' }, '*');
})();`;

const escapeScript = (s: string) => s.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');

export interface SandboxOptions {
  manifest: ExtensionManifest;
  code: string;
  config: Record<string, string>;
  timeoutMs?: number;
  /** Override for tests */
  fetchImpl?: typeof fetch;
}

const MAX_RESPONSE = 20 * 1024 * 1024;

export class SandboxedExtension implements ContentSource {
  readonly kind = 'extension' as const;
  readonly id: string;
  readonly name: string;
  readonly version: string;
  private frame?: HTMLIFrameElement;
  private ready?: Promise<void>;
  private seq = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private tokens = 10;
  private lastRefill = Date.now();
  readonly logs: string[] = [];

  constructor(private opts: SandboxOptions) {
    this.id = `ext:${opts.manifest.id}`;
    this.name = opts.manifest.name;
    this.version = opts.manifest.version;
  }

  private start() {
    if (this.ready) return this.ready;
    this.ready = new Promise<void>((resolve, reject) => {
      const f = document.createElement('iframe');
      f.setAttribute('sandbox', 'allow-scripts');
      f.setAttribute('aria-hidden', 'true');
      f.style.display = 'none';
      f.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'">
<script type="application/json" id="cfg">${escapeScript(JSON.stringify(this.opts.config))}</script>
<script>${RUNTIME}</script>
<script>${escapeScript(this.opts.code)}</script>`;
      const t = setTimeout(() => reject(new Error(`${this.name}: extension failed to start`)), 10_000);
      const onMsg = (ev: MessageEvent) => {
        if (ev.source !== f.contentWindow) return;
        const m = ev.data;
        if (m?.__furina === 'ready') {
          clearTimeout(t);
          resolve();
        } else if (m?.__furina === 'host-call') void this.handleHostCall(m.id, m.method, m.args);
        else if (m?.__furina === 'invoke-reply') {
          const p = this.pending.get(m.id);
          if (!p) return;
          clearTimeout(p.timer);
          this.pending.delete(m.id);
          if (m.error) p.reject(new Error(m.error));
          else p.resolve(m.result);
        }
      };
      window.addEventListener('message', onMsg);
      this.cleanup = () => window.removeEventListener('message', onMsg);
      document.body.appendChild(f);
      this.frame = f;
    });
    return this.ready;
  }
  private cleanup = () => {};

  private reply(id: number, result?: unknown, error?: string) {
    this.frame?.contentWindow?.postMessage({ __furina: 'host-reply', id, result, error }, '*');
  }

  private takeToken() {
    const t = Date.now();
    this.tokens = Math.min(10, this.tokens + ((t - this.lastRefill) / 1000) * 5);
    this.lastRefill = t;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  private async handleHostCall(id: number, method: string, args: unknown[]) {
    try {
      if (method === 'log') {
        this.logs.push((args as string[]).join(' ').slice(0, 500));
        if (this.logs.length > 200) this.logs.shift();
        return this.reply(id, null);
      }
      if (method !== 'fetch') throw new Error(`Unknown host method ${method}`);
      const [url, init] = args as [string, { method?: string; headers?: Record<string, string>; body?: string; responseType?: 'text' | 'json' | 'base64' }];
      if (!hostAllowed(url, this.opts.manifest.permissions.hosts)) throw new Error(`Permission denied: ${new URL(url).host} is not in this extension's allowed hosts.`);
      if (!this.takeToken()) throw new Error('Rate limit exceeded (5 requests/second).');
      const method_ = (init.method || 'GET').toUpperCase();
      if (!['GET', 'POST', 'HEAD'].includes(method_)) throw new Error('Only GET, POST and HEAD are allowed.');
      const headers = Object.fromEntries(Object.entries(init.headers || {}).filter(([k]) => !/^(cookie|authorization|host|origin)$/i.test(k)));
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 20_000);
      const res = await (this.opts.fetchImpl ?? fetch)(url, { method: method_, headers, body: init.body, signal: ctl.signal, credentials: 'omit', redirect: 'follow' });
      clearTimeout(timer);
      if (res.url && !hostAllowed(res.url, this.opts.manifest.permissions.hosts)) throw new Error('Redirected to a host that is not allowed.');
      const buf = await res.arrayBuffer();
      if (buf.byteLength > MAX_RESPONSE) throw new Error('Response too large.');
      let body: unknown;
      if (init.responseType === 'base64') {
        let bin = '';
        const u8 = new Uint8Array(buf);
        for (let k = 0; k < u8.length; k += 0x8000) bin += String.fromCharCode(...u8.subarray(k, k + 0x8000));
        body = btoa(bin);
      } else {
        const text = new TextDecoder().decode(buf);
        body = init.responseType === 'json' ? JSON.parse(text) : text;
      }
      this.reply(id, { status: res.status, ok: res.ok, headers: Object.fromEntries(res.headers.entries()), body });
    } catch (e) {
      this.reply(id, undefined, e instanceof Error ? e.message : String(e));
    }
  }

  private async invoke<T>(method: string, ...args: unknown[]): Promise<T> {
    await this.start();
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${this.name}: ${method} timed out`));
      }, this.opts.timeoutMs ?? 30_000);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.frame!.contentWindow!.postMessage({ __furina: 'invoke', id, method, args }, '*');
    });
  }

  search(query: string, page: number) {
    return this.invoke<SearchResult>('search', query, page);
  }
  details(key: string) {
    return this.invoke<MangaDetails>('details', key);
  }
  chapters(key: string) {
    return this.invoke<ChapterInfo[]>('chapters', key);
  }
  async pages(chapterKey: string) {
    const urls = await this.invoke<string[]>('pages', chapterKey);
    if (!Array.isArray(urls)) throw new Error('pages() must return an array of URLs');
    const safe = urls.filter((u) => typeof u === 'string' && hostAllowed(u, this.opts.manifest.permissions.hosts));
    if (safe.length !== urls.length) console.warn(`[${this.name}] dropped ${urls.length - safe.length} page URLs outside allowed hosts`);
    return { type: 'urls' as const, urls: safe };
  }

  dispose() {
    this.cleanup();
    this.frame?.remove();
    this.frame = undefined;
    this.ready = undefined;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error('Extension unloaded'));
    }
    this.pending.clear();
  }
}
