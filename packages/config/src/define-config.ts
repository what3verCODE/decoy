import type { Collection, Route } from '@decoy/core'

/**
 * HTTP `/admin` control API exposure (ADR-0010). `true` (the default) mounts it
 * on the same port under the `/admin` prefix; `false` disables it. The object
 * form configures the `prefix` and/or moves it to a separate `port` — the escape
 * hatch for when a real `/admin/*` upstream would otherwise be shadowed.
 */
export type AdminConfig = boolean | { port?: number; prefix?: string }

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

/** Config is a single service (object) or many services (array). Array form lands in #45. */
export type DecoyConfig = ServiceConfig | ServiceConfig[]

/**
 * Identity helper that pins the config type for editor support and lets `.ts`/`.js`
 * configs carry typed values. The config *entry* is the one place JS is allowed;
 * mock files stay declarative (ADR-0007).
 */
export function defineConfig(config: DecoyConfig): DecoyConfig {
  return config
}
