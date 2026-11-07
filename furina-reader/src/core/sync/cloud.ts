import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { dataEvents, db, getDeviceId, kvGet, kvSet } from '../db';
import type { SyncTable } from '../types';
import { coalesce, lww, mergeProgress } from './merge';

/**
 * Supabase-backed sync. Offline-first: the local DB is authoritative for the UI;
 * this module pushes the outbox and pulls remote changes when signed in.
 */

const URL_ = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const cloudConfigured = !!(URL_ && ANON);
export const supabaseUrl = URL_;
export const supabaseAnonKey = ANON;

let client: SupabaseClient | null = null;
export function supabase(): SupabaseClient | null {
  if (!cloudConfigured) return null;
  if (!client) client = createClient(URL_!, ANON!, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  return client;
}

const TABLE: Record<SyncTable, string> = {
  titles: 'library_titles',
  chapters: 'library_chapters',
  progress: 'reading_progress',
  history: 'reading_history',
  collections: 'collections',
  settings: 'user_settings',
};

const LOCAL_STORE = {
  titles: 'titles',
  chapters: 'chapters',
  progress: 'progress',
  history: 'history',
  collections: 'collections',
} as const;

export type SyncStatus = { state: 'idle' | 'syncing' | 'error' | 'offline' | 'disabled'; lastSync?: number; error?: string; pending?: number };
let status: SyncStatus = { state: cloudConfigured ? 'idle' : 'disabled' };
const statusListeners = new Set<(s: SyncStatus) => void>();
const setStatus = (s: Partial<SyncStatus>) => {
  status = { ...status, ...s };
  statusListeners.forEach((l) => l(status));
};
export const getSyncStatus = () => status;
export const onSyncStatus = (l: (s: SyncStatus) => void) => {
  statusListeners.add(l);
  return () => statusListeners.delete(l);
};

/* ------------------------------ auth -------------------------------------- */

function need() {
  const c = supabase();
  if (!c) throw new Error('Cloud sync is not configured for this build (missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).');
  return c;
}

const redirect = () => `${location.origin}${location.pathname}#/account`;

export async function signUp(email: string, password: string, displayName: string) {
  validateCredentials(email, password);
  const { error, data } = await need().auth.signUp({ email, password, options: { data: { display_name: displayName.trim().slice(0, 40) }, emailRedirectTo: redirect() } });
  if (error) throw error;
  return data;
}
export async function signIn(email: string, password: string) {
  validateCredentials(email, password);
  const { error, data } = await need().auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}
export async function signInWithProvider(provider: 'google' | 'github' | 'discord') {
  const { error } = await need().auth.signInWithOAuth({ provider, options: { redirectTo: redirect() } });
  if (error) throw error;
}
export async function sendPasswordReset(email: string) {
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Enter a valid email address.');
  const { error } = await need().auth.resetPasswordForEmail(email, { redirectTo: redirect() });
  if (error) throw error;
}
export async function updatePassword(password: string) {
  if (password.length < 8) throw new Error('Password must be at least 8 characters.');
  const { error } = await need().auth.updateUser({ password });
  if (error) throw error;
}
export async function signOut() {
  await supabase()?.auth.signOut();
  await kvSet('sync.cursor', undefined);
}
export async function getSession(): Promise<Session | null> {
  const c = supabase();
  if (!c) return null;
  return (await c.auth.getSession()).data.session;
}

export function validateCredentials(email: string, password: string) {
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Enter a valid email address.');
  if (password.length < 8) throw new Error('Password must be at least 8 characters.');
}

/* ------------------------------ devices ----------------------------------- */

export function platformName(): string {
  const w = window as unknown as { __TAURI_INTERNALS__?: unknown; Capacitor?: { getPlatform(): string } };
  if (w.__TAURI_INTERNALS__) return 'windows';
  if (w.Capacitor?.getPlatform?.() === 'android') return 'android';
  return 'web';
}

export async function registerDevice() {
  const c = supabase();
  const s = await getSession();
  if (!c || !s) return;
  const ua = navigator.userAgent;
  const name = /Android/.test(ua) ? 'Android device' : /Windows/.test(ua) ? 'Windows PC' : /Mac/.test(ua) ? 'Mac' : /iPhone|iPad/.test(ua) ? 'iOS device' : 'Browser';
  await c.from('devices').upsert({ user_id: s.user.id, device_id: getDeviceId(), name, platform: platformName(), last_seen: new Date().toISOString() });
}

export async function listDevices() {
  const c = need();
  const { data, error } = await c.from('devices').select('*').order('last_seen', { ascending: false });
  if (error) throw error;
  return data as { device_id: string; name: string; platform: string; last_seen: string }[];
}

export async function removeDevice(deviceId: string) {
  const { error } = await need().from('devices').delete().eq('device_id', deviceId);
  if (error) throw error;
}

/* ------------------------------ sync -------------------------------------- */

let running: Promise<void> | null = null;

export function syncNow(): Promise<void> {
  if (!running) running = doSync().finally(() => (running = null));
  return running;
}

async function doSync() {
  const c = supabase();
  if (!c) return setStatus({ state: 'disabled' });
  const session = await getSession();
  if (!session) return setStatus({ state: 'idle', error: undefined });
  if (!navigator.onLine) return setStatus({ state: 'offline' });
  setStatus({ state: 'syncing', error: undefined });
  try {
    await push(c, session.user.id);
    await pull(c);
    await registerDevice();
    setStatus({ state: 'idle', lastSync: Date.now(), pending: await (await db()).count('outbox') });
  } catch (e) {
    setStatus({ state: 'error', error: e instanceof Error ? e.message : String(e) });
  }
}

async function push(c: SupabaseClient, userId: string) {
  const d = await db();
  const entries = await d.getAll('outbox');
  if (!entries.length) return;
  const latest = coalesce(entries);
  const byTable = new Map<SyncTable, typeof latest>();
  for (const e of latest) byTable.set(e.table, [...(byTable.get(e.table) ?? []), e]);
  for (const [table, rows] of byTable) {
    const payload = rows.map((r) => ({
      user_id: userId,
      id: r.rowId,
      data: r.op === 'delete' ? null : r.payload,
      deleted: r.op === 'delete',
      updated_at: r.at,
    }));
    for (let i = 0; i < payload.length; i += 200) {
      const { error } = await c.from(TABLE[table]).upsert(payload.slice(i, i + 200), { onConflict: 'user_id,id' });
      if (error) throw new Error(`${TABLE[table]}: ${error.message}`);
    }
  }
  const maxSeq = Math.max(...entries.map((e) => e.seq!));
  const tx = d.transaction('outbox', 'readwrite');
  for (const e of await tx.store.getAll()) if (e.seq! <= maxSeq) await tx.store.delete(e.seq!);
  await tx.done;
}

interface RemoteRow {
  id: string;
  data: Record<string, unknown> | null;
  deleted: boolean;
  updated_at: number;
  server_updated_at: string;
}

async function pull(c: SupabaseClient) {
  const cursors = ((await kvGet<Record<string, string>>('sync.cursor')) ?? {}) as Record<string, string>;
  let changed = 0;
  for (const table of Object.keys(LOCAL_STORE) as (keyof typeof LOCAL_STORE)[]) {
    let since = cursors[table] ?? '1970-01-01T00:00:00Z';
    for (let page = 0; page < 50; page++) {
      const { data, error } = await c
        .from(TABLE[table])
        .select('id,data,deleted,updated_at,server_updated_at')
        .gt('server_updated_at', since)
        .order('server_updated_at', { ascending: true })
        .limit(500);
      if (error) throw new Error(`${TABLE[table]}: ${error.message}`);
      const rows = (data ?? []) as RemoteRow[];
      if (!rows.length) break;
      changed += rows.length;
      await applyRemote(table, rows);
      since = rows[rows.length - 1].server_updated_at;
      if (rows.length < 500) break;
    }
    cursors[table] = since;
  }
  await kvSet('sync.cursor', cursors);
  // Only notify when something arrived, otherwise UI refresh → auto-sync → pull would loop.
  if (changed) ['titles', 'chapters', 'progress', 'history', 'collections'].forEach((s) => dataEvents.emit(s));
}

async function applyRemote(table: keyof typeof LOCAL_STORE, rows: RemoteRow[]) {
  const d = await db();
  const storeName = LOCAL_STORE[table];
  const tx = d.transaction(storeName, 'readwrite');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const store = tx.objectStore(storeName) as any;
  for (const r of rows) {
    const local = await store.get(r.id);
    if (table === 'progress') {
      if (r.deleted) {
        if (local && local.updatedAt <= r.updated_at) await store.delete(r.id);
        continue;
      }
      const merged = mergeProgress(local, r.data as never);
      if (merged) await store.put(merged);
      continue;
    }
    if (table === 'history') {
      if (r.deleted) await store.delete(r.id);
      else if (!local) await store.put(r.data);
      continue;
    }
    const remote = r.deleted ? { ...(local ?? { id: r.id }), deleted: true, inLibrary: false, updatedAt: r.updated_at } : { ...(r.data as object), updatedAt: r.updated_at };
    const winner = lww(local, remote as never) as Record<string, unknown> | undefined;
    if (!winner || winner === local) continue;
    // keep device-local fields (file blobs, local covers)
    if (local?.fileId) winner.fileId = local.fileId;
    if (typeof local?.cover === 'string' && local.cover.startsWith('file:') && !winner.cover) winner.cover = local.cover;
    await store.put(winner);
  }
  await tx.done;
}

/** Wire automatic sync: on sign-in, reconnect, local changes (debounced) and every 2 minutes. */
export function startAutoSync() {
  const c = supabase();
  if (!c) return () => {};
  let t: ReturnType<typeof setTimeout> | undefined;
  const soon = () => {
    clearTimeout(t);
    t = setTimeout(() => void syncNow(), 4000);
  };
  const { data: sub } = c.auth.onAuthStateChange((ev) => {
    if (ev === 'SIGNED_IN' || ev === 'INITIAL_SESSION') void syncNow();
  });
  const off = dataEvents.on((scope) => {
    if (['titles', 'chapters', 'progress', 'history', 'collections'].includes(scope)) soon();
  });
  const onOnline = () => void syncNow();
  window.addEventListener('online', onOnline);
  const iv = setInterval(() => void syncNow(), 120_000);
  return () => {
    sub.subscription.unsubscribe();
    off();
    window.removeEventListener('online', onOnline);
    clearInterval(iv);
  };
}
