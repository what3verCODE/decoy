import type { ResolvedRequestLog } from '@decoy/config'
import type { RequestLog } from './logger'
import { createSqliteRequestLogStore } from './sqlite-request-log-store'

/**
 * The input to {@link RequestLogStore.append}: the structured {@link RequestLog}
 * plus the `service` (instance name) that handled it — the store's `service`
 * column, so a single shared store can hold records from every instance of a
 * multi-instance config (ADR-0006) and a query can scope to one.
 */
export interface RequestLogInput extends RequestLog {
  /** The instance (service) name that served the request. */
  service: string
}

/**
 * A persisted request record: the {@link RequestLogInput} plus the store-assigned
 * `seq` and `ts`. The `seq` is monotonic and stable across replay so an SSE client
 * can dedupe re-delivered history after a reconnect (it doubles as the SSE `id:` /
 * `Last-Event-ID`). The `ts` is the epoch-ms append time — the store's time key
 * `(service, session, ts)`.
 */
export interface StoredRequestLog extends RequestLogInput {
  /** Monotonic id assigned on append; never reused, stable across replay. */
  seq: number
  /** Epoch milliseconds when the record was appended (the store's time key). */
  ts: number
}

/** Filter for {@link RequestLogStore.query}: any combination of `service` and `session`. */
export interface RequestLogQuery {
  /** Restrict to one instance's records. */
  service?: string
  /** Restrict to one session's records (`'global'` or a session id). */
  session?: string
}

/**
 * Write-only observability sink for completed requests (ADR-0017): it ingests the
 * same {@link RequestLog} `Logger.request()` emits, retains recent history, and
 * lets a consumer (the `GET /admin/logs` SSE stream) replay that history then tail
 * new records. Records are *not* engine state — `core` stays pure (ADR-0012); the
 * store lives in `@decoy/server` where IO is allowed. Two impls share this contract:
 * the process-bound in-memory ring and the durable `node:sqlite` store (#70).
 */
export interface RequestLogStore {
  /** Record one completed request; returns it with its assigned `seq` and `ts`. */
  append(log: RequestLogInput): StoredRequestLog
  /** Recent retained records, oldest-first (bounded by capacity). */
  snapshot(): StoredRequestLog[]
  /** Records matching `filter`, oldest-first across services — `(service, session)` scoped. */
  query(filter?: RequestLogQuery): StoredRequestLog[]
  /**
   * Observe records appended *after* this call (history is not replayed). Returns
   * an unsubscribe function. Subscribing is synchronous with no `await`, so a
   * caller can `snapshot()` then `subscribe()` with no gap and no duplicate.
   */
  subscribe(listener: (record: StoredRequestLog) => void): () => void
  /**
   * Signal a session was destroyed. Under sqlite `cleanup: 'on-session-end'` this
   * drops that session's records (disabling post-session retrieval); otherwise it
   * is a no-op — logs survive session destruction (ADR-0017).
   */
  endSession(session: string): void
  /** Release resources; under sqlite `cleanup: 'on-exit'` the durable file is removed. */
  close(): void
}

/**
 * A {@link RequestLogStore} that can be shared across N holders with close-once
 * ownership (ADR-0017, #80). The multi-instance aggregator (#72) shares one store
 * across every instance; each instance {@link acquire}s a holder handle and closes
 * it independently on shutdown. The underlying store's `close()` — and so its
 * cleanup policy (sqlite `on-exit` file removal) — runs **exactly once**, after the
 * last holder releases. This models shared ownership as a seam, replacing the
 * `ownsStore` flag in the server and the ref-counting close-wrapper in the CLI.
 */
export interface SharedRequestLogStore {
  /**
   * Take a holder handle on the shared store. It is a full {@link RequestLogStore}
   * whose reads/writes pass through to the shared store; its `close()` releases
   * just this holder's reference (idempotent — a double close is a no-op), and the
   * underlying store closes only when every acquired handle has closed.
   */
  acquire(): RequestLogStore
}

/**
 * Wrap a {@link RequestLogStore} so it can be shared across N holders with
 * close-once semantics (#80). Each holder takes a handle via
 * {@link SharedRequestLogStore.acquire}; the underlying store's `close()` runs once,
 * after the last handle closes — so a sqlite `cleanup: 'on-exit'` store removes its
 * file exactly once on graceful shutdown, with no double `db.close()` (which throws).
 * The store is created and owned by the caller (the CLI), which acquires a handle per
 * instance; ownership lives here as a seam, not as a convention spread across callers.
 */
export function createSharedRequestLogStore(store: RequestLogStore): SharedRequestLogStore {
  let holders = 0
  let storeClosed = false
  return {
    acquire() {
      holders += 1
      let released = false
      return {
        append: (log) => store.append(log),
        snapshot: () => store.snapshot(),
        query: (filter) => store.query(filter),
        subscribe: (listener) => store.subscribe(listener),
        endSession: (session) => store.endSession(session),
        close() {
          if (released) {
            return
          }
          released = true
          holders -= 1
          if (holders === 0 && !storeClosed) {
            storeClosed = true
            store.close()
          }
        },
      }
    },
  }
}

export interface MemoryRequestLogStoreOptions {
  /** Max records retained; the oldest are ring-evicted past this. Default 1000. */
  capacity?: number
  /** Clock injection for the assigned `ts` (defaults to `Date.now`). */
  now?: () => number
}

/** Default ring size — enough scrollback for a dev session, bounded so memory can't grow. */
const DEFAULT_CAPACITY = 1000

/** True when a record matches an optional `(service, session)` filter. */
function matches(record: StoredRequestLog, filter?: RequestLogQuery): boolean {
  if (filter?.service !== undefined && record.service !== filter.service) {
    return false
  }
  if (filter?.session !== undefined && record.session !== filter.session) {
    return false
  }
  return true
}

/**
 * An in-memory, bounded-ring {@link RequestLogStore}. Process-bound (lost on exit);
 * the durable `node:sqlite` store ({@link createSqliteRequestLogStore}) is the
 * alternative behind the same contract. Retains the most recent `capacity` records,
 * evicting the oldest. `cleanup` is a no-op here — it is sqlite-only.
 */
export function createMemoryRequestLogStore(
  options: MemoryRequestLogStoreOptions = {},
): RequestLogStore {
  const capacity = Math.max(1, options.capacity ?? DEFAULT_CAPACITY)
  const now = options.now ?? Date.now
  const ring: StoredRequestLog[] = []
  const listeners = new Set<(record: StoredRequestLog) => void>()
  let nextSeq = 1

  return {
    append(log) {
      const record: StoredRequestLog = { ...log, seq: nextSeq++, ts: now() }
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
    query(filter) {
      return ring.filter((record) => matches(record, filter))
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    endSession() {
      // No-op: the memory store keeps records until eviction (cleanup is sqlite-only).
    },
    close() {
      // No-op: nothing to release for the process-bound ring.
    },
  }
}

/**
 * Build the {@link RequestLogStore} a server records to from its resolved config
 * (#70): the durable `node:sqlite` store when `store: 'sqlite'`, else the in-memory
 * ring. `retention.maxRows` ring-evicts the oldest in either store. Absent config
 * (an embedding adapter that hand-builds a service) yields the in-memory default.
 */
export function createRequestLogStore(config?: ResolvedRequestLog): RequestLogStore {
  if (config?.store === 'sqlite' && config.path !== undefined) {
    return createSqliteRequestLogStore({
      path: config.path,
      capacity: config.maxRows,
      cleanup: config.cleanup,
    })
  }
  return createMemoryRequestLogStore(
    config?.maxRows !== undefined ? { capacity: config.maxRows } : {},
  )
}
