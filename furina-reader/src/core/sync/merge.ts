import type { Progress } from '../types';

/** Pure conflict-resolution rules, shared by push & pull (unit-tested). */

export interface Versioned {
  updatedAt: number;
  deleted?: boolean;
}

/** Last-writer-wins on updatedAt; tombstones win ties so deletes are not resurrected. */
export function lww<T extends Versioned>(local: T | undefined, remote: T | undefined): T | undefined {
  if (!local) return remote;
  if (!remote) return local;
  if (remote.updatedAt > local.updatedAt) return remote;
  if (remote.updatedAt < local.updatedAt) return local;
  return remote.deleted ? remote : local;
}

/**
 * Reading progress: the furthest position wins (reading on the phone then
 * opening the laptop must not jump back), completion is sticky, and the
 * newest timestamp is kept so "continue reading" ordering stays right.
 */
export function mergeProgress(local: Progress | undefined, remote: Progress | undefined): Progress | undefined {
  if (!local) return remote;
  if (!remote) return local;
  const furthest = remote.page > local.page ? remote : remote.page < local.page ? local : remote.updatedAt > local.updatedAt ? remote : local;
  return {
    ...furthest,
    completed: local.completed || remote.completed,
    updatedAt: Math.max(local.updatedAt, remote.updatedAt),
    pageCount: Math.max(local.pageCount, remote.pageCount),
  };
}

/** Collapse multiple outbox entries for the same row into the latest one. */
export function coalesce<T extends { table: string; rowId: string; at: number }>(entries: T[]): T[] {
  const m = new Map<string, T>();
  for (const e of entries) {
    const k = `${e.table}:${e.rowId}`;
    const prev = m.get(k);
    if (!prev || e.at >= prev.at) m.set(k, e);
  }
  return [...m.values()];
}
