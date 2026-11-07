/* Shared data model — used by every platform. Keep free of React / DOM UI. */

export type ReadingStatus = 'reading' | 'completed' | 'on_hold' | 'dropped' | 'plan_to_read';
export const READING_STATUSES: { id: ReadingStatus; label: string }[] = [
  { id: 'reading', label: 'Reading' },
  { id: 'completed', label: 'Completed' },
  { id: 'on_hold', label: 'On Hold' },
  { id: 'dropped', label: 'Dropped' },
  { id: 'plan_to_read', label: 'Plan to Read' },
];

export type ContentFormat = 'cbz' | 'cbr' | 'zip' | 'epub' | 'pdf' | 'images' | 'remote';

/** A series / book in the user's library. */
export interface Title {
  id: string;
  /** Source that provides chapters: 'local', 'opds:<catalogId>', 'ext:<extensionId>' */
  sourceId: string;
  /** Source-specific key (OPDS feed URL, extension manga id…). Empty for local. */
  sourceKey: string;
  title: string;
  altTitles: string[];
  authors: string[];
  artists: string[];
  description: string;
  genres: string[];
  /** Cover: a FileRecord id (`file:<id>`), a data/http URL, or empty. */
  cover: string;
  status: ReadingStatus;
  favorite: boolean;
  collectionIds: string[];
  /** Linked metadata provider id, e.g. 'anilist:30013'. */
  metadataRef?: string;
  inLibrary: boolean;
  addedAt: number;
  updatedAt: number;
  lastReadAt?: number;
  deleted?: boolean;
}

export interface Chapter {
  id: string;
  titleId: string;
  name: string;
  number: number; // -1 when unknown
  volume?: number;
  format: ContentFormat;
  /** For local content: FileRecord id holding the original archive / pdf / image set. */
  fileId?: string;
  /** For remote content: source-specific chapter key. */
  sourceKey?: string;
  pageCount?: number;
  addedAt: number;
  updatedAt: number;
  /** Set when a remote chapter is first seen during an update check and not yet opened. */
  isNew?: boolean;
  deleted?: boolean;
}

export interface FileRecord {
  id: string;
  name: string;
  size: number;
  mime: string;
  /** Quick fingerprint for duplicate detection: sha256(size + head 256KiB + tail 256KiB). */
  fingerprint: string;
  blob: Blob;
  /** For multi-image imports, each image is its own blob in order. */
  parts?: Blob[];
  partNames?: string[];
  createdAt: number;
}

export interface Progress {
  chapterId: string;
  titleId: string;
  page: number; // 0-based
  pageCount: number;
  completed: boolean;
  updatedAt: number;
  deviceId: string;
}

export interface HistoryEntry {
  id: string;
  titleId: string;
  chapterId: string;
  startedAt: number;
  endedAt: number;
  pagesRead: number;
  /** milliseconds actively reading */
  durationMs: number;
}

export interface Collection {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  deleted?: boolean;
}

export type DownloadState = 'queued' | 'downloading' | 'paused' | 'done' | 'failed';
export interface DownloadTask {
  id: string;
  titleId: string;
  chapterId: string;
  label: string;
  state: DownloadState;
  receivedBytes: number;
  totalBytes: number;
  error?: string;
  attempts: number;
  createdAt: number;
  updatedAt: number;
}

/** A single readable page, produced lazily by a PageSource. */
export type LoadedPage =
  | { kind: 'image'; url: string; width?: number; height?: number; revoke?: () => void }
  | { kind: 'html'; html: string };

export interface PageSource {
  readonly count: number;
  /** Human labels (file names) when known. */
  readonly names?: string[];
  load(index: number, signal?: AbortSignal): Promise<LoadedPage>;
  dispose(): void;
}

export interface OutboxEntry {
  seq?: number;
  table: SyncTable;
  rowId: string;
  op: 'upsert' | 'delete';
  payload: unknown;
  at: number;
}
export type SyncTable = 'titles' | 'chapters' | 'progress' | 'history' | 'collections' | 'settings';
