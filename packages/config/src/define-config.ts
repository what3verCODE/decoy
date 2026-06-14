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
 * One Decoy service: a single upstream impersonated on one port. `routesDir`
 * (recursive) and `collectionsFile` are resolved relative to the config file
 * (or cwd). Routes/collections may also be supplied inline.
 */
export interface ServiceConfig {
  /** Display name for logs; defaults to `'decoy'`. */
  name?: string
  /** Port to listen on. */
  port: number
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
