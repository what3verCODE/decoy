import type { Collection, Route } from '@decoy/core'

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
