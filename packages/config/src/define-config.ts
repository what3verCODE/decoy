import type { Collection, Route } from '@decoy/core'

/**
 * HTTP `/admin` control API exposure (ADR-0010). `true` (the default) mounts it
 * on the same port under the `/admin` prefix; `false` disables it. The object
 * form configures the `prefix` and/or moves it to a separate `port` — the escape
 * hatch for when a real `/admin/*` upstream would otherwise be shadowed.
 */
export type AdminConfig = boolean | { port?: number; prefix?: string }

/**
 * Global passthrough (ADR-0005): when set, **unmatched** requests are forwarded
 * verbatim to this single upstream (`{url}{path}{query}`, method/headers/body
 * forwarded, response returned as-is) instead of failing closed. Off by default —
 * a test can never silently reach the real API. Global per instance; no
 * per-route/per-variant targets.
 */
export type PassthroughConfig = { url: string }

/**
 * Durable request-log store (#70). `store` selects the backing of the request-log
 * ring (the `GET /admin/logs` stream, ADR-0017): the process-bound in-memory store
 * (default) or a `node:sqlite` file shared across this config's instances. `path`
 * is a filename template resolved **once at boot** — `%Y %m %d %H %M %S %s`
 * (UTC strftime) and `{name} {pid} {port}` (named) tokens; an unknown token fails
 * `decoy check`. `retention.maxRows` ring-evicts the oldest records in either
 * store. `cleanup` is **sqlite-only** (a no-op for the memory store): `on-exit`
 * removes the file on shutdown, `on-session-end` drops a session's rows on destroy
 * (which disables post-session log retrieval), `never` keeps the file (default).
 * With no `path`, sqlite defaults to a file under a gitignored `.decoy/`.
 */
export interface RequestLogConfig {
  /** Backing store for the request log; defaults to `'memory'`. */
  store?: 'memory' | 'sqlite'
  /** Filename template for the sqlite store, resolved once at boot. Sqlite-only. */
  path?: string
  /** Retention policy applied to both stores. */
  retention?: {
    /** Ring-evict the oldest records past this count. */
    maxRows?: number
  }
  /** Cleanup mode for the sqlite file; defaults to `'never'`. Sqlite-only. */
  cleanup?: 'on-exit' | 'on-session-end' | 'never'
}

/**
 * One Decoy service: a single upstream impersonated on one port. `routesDir`
 * (recursive) and `collectionsFile` are resolved relative to the config file
 * (or cwd). Routes/collections may also be supplied inline.
 */
export interface ServiceConfig {
  /** Display name for logs; defaults to `'decoy'`. */
  name?: string
  /**
   * Port the server listens on; defaults to `4000`. A server transport concern —
   * irrelevant to the in-process router surfaces (e.g. @decoy/playwright), which boot
   * no server, so it can be omitted there.
   */
  port?: number
  /** HTTP `/admin` control API exposure; defaults to on (same port, `/admin` prefix). */
  admin?: AdminConfig
  /** HTTP status returned for a fail-closed miss (ADR-0005); defaults to 501. */
  missStatus?: number
  /**
   * Global passthrough target (ADR-0005). When set, unmatched requests are
   * forwarded verbatim to this upstream instead of failing closed. Off by default.
   */
  passthrough?: PassthroughConfig
  /**
   * Idle TTL in ms after which an abandoned **session** is reaped (ADR-0011);
   * defaults to 30 minutes. Sessions are a tests-only concern.
   */
  sessionIdleTtl?: number
  /** Directory of route definition files, scanned recursively. */
  routesDir?: string
  /** Single file holding the ordered collections. */
  collectionsFile?: string
  /** Boot collection id; defaults to the first collection defined. */
  defaultCollection?: string
  /** Durable request-log store (#70); defaults to the in-memory store. */
  requestLog?: RequestLogConfig
  /** Inline route definitions, merged with `routesDir`. */
  routes?: Route[]
  /** Inline collections, merged with `collectionsFile`. */
  collections?: Collection[]
}

/**
 * Config is a single service (object) or many services (array). An array boots
 * **one instance per entry** (ADR-0006), each on its own port with independent
 * routes/collections/passthrough — `decoy start` runs them all.
 */
export type DecoyConfig = ServiceConfig | ServiceConfig[]

/**
 * Identity helper that pins the config type for editor support and lets `.ts`/`.js`
 * configs carry typed values. The config *entry* is the one place JS is allowed;
 * mock files stay declarative (ADR-0007).
 */
export function defineConfig(config: DecoyConfig): DecoyConfig {
  return config
}
