import { mkdirSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { RequestOutcome } from './logger'
import type { RequestLogStore, StoredRequestLog } from './request-log-store'

export interface SqliteRequestLogStoreOptions {
  /** Resolved sqlite file path (its directory is created if missing). */
  path: string
  /** Max records retained; the oldest are ring-evicted past this. Unset = unbounded (durable). */
  capacity?: number
  /**
   * Cleanup mode (#70). `'on-exit'` removes the file on {@link RequestLogStore.close};
   * `'on-session-end'` drops a session's rows on {@link RequestLogStore.endSession}
   * (disabling post-session retrieval); `'never'` (default) keeps the file across runs.
   */
  cleanup?: 'on-exit' | 'on-session-end' | 'never'
  /** Clock injection for the assigned `ts` (defaults to `Date.now`). */
  now?: () => number
}

/** Bound on the replay snapshot when retention is unbounded, so SSE replay stays finite. */
const DEFAULT_SNAPSHOT_LIMIT = 1000

interface Row {
  seq: number | bigint
  service: string
  session: string
  ts: number | bigint
  method: string
  path: string
  status: number | bigint
  latency_ms: number
  outcome: string
}

function rowToRecord(row: Row): StoredRequestLog {
  return {
    seq: Number(row.seq),
    service: row.service,
    session: row.session,
    ts: Number(row.ts),
    method: row.method,
    path: row.path,
    status: Number(row.status),
    latencyMs: row.latency_ms,
    outcome: JSON.parse(row.outcome) as RequestOutcome,
  }
}

/**
 * A durable {@link RequestLogStore} backed by the built-in `node:sqlite` module (no
 * external dependency). One table shared across a config's instances, keyed by a
 * `(service, session, ts)` index; `seq` is an `AUTOINCREMENT` primary key, so it
 * stays monotonic across eviction and re-opens (the SSE `id:`). Records survive
 * session destruction and process restarts unless `cleanup` says otherwise (#70).
 */
export function createSqliteRequestLogStore(
  options: SqliteRequestLogStoreOptions,
): RequestLogStore {
  const { path } = options
  const cleanup = options.cleanup ?? 'never'
  const capacity = options.capacity
  const now = options.now ?? Date.now
  const listeners = new Set<(record: StoredRequestLog) => void>()

  mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec(`
    CREATE TABLE IF NOT EXISTS request_log (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      service TEXT NOT NULL,
      session TEXT NOT NULL,
      ts INTEGER NOT NULL,
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      status INTEGER NOT NULL,
      latency_ms REAL NOT NULL,
      outcome TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS request_log_service_session_ts
      ON request_log (service, session, ts);
  `)

  const insertStmt = db.prepare(
    `INSERT INTO request_log (service, session, ts, method, path, status, latency_ms, outcome)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  // Ring-evict: keep only the newest `capacity` rows by seq (the oldest fall out).
  const evictStmt =
    capacity !== undefined
      ? db.prepare(
          `DELETE FROM request_log
           WHERE seq NOT IN (SELECT seq FROM request_log ORDER BY seq DESC LIMIT ?)`,
        )
      : undefined
  const deleteSessionStmt = db.prepare(`DELETE FROM request_log WHERE session = ?`)

  return {
    append(log) {
      const ts = now()
      const info = insertStmt.run(
        log.service,
        log.session,
        ts,
        log.method,
        log.path,
        log.status,
        log.latencyMs,
        JSON.stringify(log.outcome),
      )
      if (evictStmt) {
        evictStmt.run(capacity as number)
      }
      const record: StoredRequestLog = { ...log, seq: Number(info.lastInsertRowid), ts }
      for (const listener of listeners) {
        listener(record)
      }
      return record
    },
    snapshot() {
      const limit = capacity ?? DEFAULT_SNAPSHOT_LIMIT
      const rows = db
        .prepare(`SELECT * FROM request_log ORDER BY seq DESC LIMIT ?`)
        .all(limit) as unknown as Row[]
      return rows.map(rowToRecord).reverse()
    },
    query(filter) {
      const clauses: string[] = []
      const params: string[] = []
      if (filter?.service !== undefined) {
        clauses.push('service = ?')
        params.push(filter.service)
      }
      if (filter?.session !== undefined) {
        clauses.push('session = ?')
        params.push(filter.session)
      }
      const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
      const rows = db
        .prepare(`SELECT * FROM request_log ${where} ORDER BY ts, seq`)
        .all(...params) as unknown as Row[]
      return rows.map(rowToRecord)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    endSession(session) {
      if (cleanup === 'on-session-end') {
        deleteSessionStmt.run(session)
      }
    },
    close() {
      db.close()
      if (cleanup === 'on-exit') {
        // Remove the file and any rollback/WAL sidecars left by the engine.
        for (const suffix of ['', '-journal', '-wal', '-shm']) {
          rmSync(`${path}${suffix}`, { force: true })
        }
      }
    },
  }
}
