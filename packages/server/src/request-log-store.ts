import type { RequestLog } from './logger'

/**
 * A persisted request record: the structured {@link RequestLog} plus a
 * store-assigned, monotonic `seq`. The `seq` is stable across replay so an SSE
 * client can dedupe re-delivered history after a reconnect (it doubles as the
 * SSE `id:` / `Last-Event-ID`).
 */
export interface StoredRequestLog extends RequestLog {
  /** Monotonic id assigned on append; never reused, stable across replay. */
  seq: number
}

/**
 * Write-only observability sink for completed requests (ADR-0017): it ingests the
 * same {@link RequestLog} `Logger.request()` emits, retains recent history, and
 * lets a consumer (the `GET /admin/logs` SSE stream) replay that history then tail
 * new records. Records are *not* engine state — `core` stays pure (ADR-0012); the
 * store lives in `@decoy/server` where IO is allowed.
 */
export interface RequestLogStore {
  /** Record one completed request; returns it with its assigned `seq`. */
  append(log: RequestLog): StoredRequestLog
  /** Recent retained records, oldest-first (bounded by capacity). */
  snapshot(): StoredRequestLog[]
  /**
   * Observe records appended *after* this call (history is not replayed). Returns
   * an unsubscribe function. Subscribing is synchronous with no `await`, so a
   * caller can `snapshot()` then `subscribe()` with no gap and no duplicate.
   */
  subscribe(listener: (record: StoredRequestLog) => void): () => void
}

export interface MemoryRequestLogStoreOptions {
  /** Max records retained; the oldest are ring-evicted past this. Default 1000. */
  capacity?: number
}

/** Default ring size — enough scrollback for a dev session, bounded so memory can't grow. */
const DEFAULT_CAPACITY = 1000

/**
 * An in-memory, bounded-ring {@link RequestLogStore}. Process-bound (lost on
 * exit) — the durable `node:sqlite` store lands separately (#70). Retains the
 * most recent `capacity` records, evicting the oldest.
 */
export function createMemoryRequestLogStore(
  options: MemoryRequestLogStoreOptions = {},
): RequestLogStore {
  const capacity = Math.max(1, options.capacity ?? DEFAULT_CAPACITY)
  const ring: StoredRequestLog[] = []
  const listeners = new Set<(record: StoredRequestLog) => void>()
  let nextSeq = 1

  return {
    append(log) {
      const record: StoredRequestLog = { ...log, seq: nextSeq++ }
      ring.push(record)
      if (ring.length > capacity) {
        ring.shift()
      }
      for (const listener of listeners) {
        listener(record)
      }
      return record
    },
    snapshot() {
      return [...ring]
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
