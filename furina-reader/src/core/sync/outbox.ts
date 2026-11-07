import { db } from '../db';
import type { SyncTable } from '../types';

/**
 * Every syncable mutation is recorded here while offline (or always — the
 * sync engine drains it when a cloud session exists). Entries for the same
 * row are coalesced at push time, so the outbox stays cheap.
 */
export async function queueChange(table: SyncTable, rowId: string, payload: unknown, op: 'upsert' | 'delete' = 'upsert') {
  try {
    await (await db()).add('outbox', { table, rowId, op, payload, at: Date.now() });
  } catch (e) {
    console.warn('[sync] failed to queue change', e);
  }
}

export async function outboxSize() {
  return (await db()).count('outbox');
}
