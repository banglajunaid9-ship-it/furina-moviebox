import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  Chapter,
  Collection,
  DownloadTask,
  FileRecord,
  HistoryEntry,
  OutboxEntry,
  Progress,
  Title,
} from './types';

export interface InstalledExtension {
  id: string;
  name: string;
  version: string;
  code: string;
  manifest: unknown;
  sourceUrl?: string;
  enabled: boolean;
  installedAt: number;
  config: Record<string, string>;
}

export interface OpdsCatalog {
  id: string;
  name: string;
  url: string;
  /** Optional HTTP Basic credentials for the user's own server. Stored locally only, never synced. */
  username?: string;
  password?: string;
  addedAt: number;
}

export interface AiMessage {
  id: string;
  threadKey: string; // `${titleId}:${chapterId}` or 'general'
  role: 'user' | 'assistant';
  content: string;
  at: number;
  /** Chapter number the user had reached when the message was sent (spoiler boundary). */
  chapterNumber?: number;
}

interface FurinaDB extends DBSchema {
  titles: { key: string; value: Title; indexes: { bySource: string; byUpdated: number } };
  chapters: { key: string; value: Chapter; indexes: { byTitle: string } };
  files: { key: string; value: FileRecord; indexes: { byFingerprint: string } };
  progress: { key: string; value: Progress; indexes: { byTitle: string; byUpdated: number } };
  history: { key: string; value: HistoryEntry; indexes: { byEnded: number; byTitle: string } };
  collections: { key: string; value: Collection };
  downloads: { key: string; value: DownloadTask; indexes: { byChapter: string } };
  /** Downloaded remote chapter content (archive bytes). */
  offline: { key: string; value: { chapterId: string; blob: Blob; name: string; savedAt: number } };
  extensions: { key: string; value: InstalledExtension };
  opds: { key: string; value: OpdsCatalog };
  ai: { key: string; value: AiMessage; indexes: { byThread: string } };
  kv: { key: string; value: unknown };
  outbox: { key: number; value: OutboxEntry };
}

let dbp: Promise<IDBPDatabase<FurinaDB>> | null = null;

export function db() {
  if (!dbp) {
    dbp = openDB<FurinaDB>('furina-reader', 1, {
      upgrade(d) {
        const t = d.createObjectStore('titles', { keyPath: 'id' });
        t.createIndex('bySource', 'sourceId');
        t.createIndex('byUpdated', 'updatedAt');
        d.createObjectStore('chapters', { keyPath: 'id' }).createIndex('byTitle', 'titleId');
        d.createObjectStore('files', { keyPath: 'id' }).createIndex('byFingerprint', 'fingerprint');
        const p = d.createObjectStore('progress', { keyPath: 'chapterId' });
        p.createIndex('byTitle', 'titleId');
        p.createIndex('byUpdated', 'updatedAt');
        const h = d.createObjectStore('history', { keyPath: 'id' });
        h.createIndex('byEnded', 'endedAt');
        h.createIndex('byTitle', 'titleId');
        d.createObjectStore('collections', { keyPath: 'id' });
        d.createObjectStore('downloads', { keyPath: 'id' }).createIndex('byChapter', 'chapterId');
        d.createObjectStore('offline', { keyPath: 'chapterId' });
        d.createObjectStore('extensions', { keyPath: 'id' });
        d.createObjectStore('opds', { keyPath: 'id' });
        d.createObjectStore('ai', { keyPath: 'id' }).createIndex('byThread', 'threadKey');
        d.createObjectStore('kv');
        d.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true });
      },
      blocking() {
        // Another tab wants to upgrade — close so it can proceed.
        dbp?.then((x) => x.close());
        dbp = null;
      },
    });
  }
  return dbp;
}

/** For tests: drop the cached connection. */
export function resetDbForTests() {
  dbp = null;
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  return (await (await db()).get('kv', key)) as T | undefined;
}
export async function kvSet(key: string, value: unknown) {
  await (await db()).put('kv', value, key);
}

/** Ask the browser not to evict our storage (offline library). */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

export async function storageEstimate(): Promise<{ usage: number; quota: number }> {
  try {
    const e = await navigator.storage.estimate();
    return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
  } catch {
    return { usage: 0, quota: 0 };
  }
}

export function getDeviceId(): string {
  const KEY = 'furina.deviceId';
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return 'ephemeral';
  }
}

/** Change notification so React Query caches can refresh across features. */
type Listener = (scope: string) => void;
const listeners = new Set<Listener>();
export const dataEvents = {
  emit(scope: string) {
    listeners.forEach((l) => l(scope));
  },
  on(l: Listener) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};
