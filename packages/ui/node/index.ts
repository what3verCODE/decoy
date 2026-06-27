import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Computed dynamically (not `new URL(...)`) so bundlers leave these runtime paths
// alone — correct from source (dev), the published dist build, and the test runner.
const here = dirname(fileURLToPath(import.meta.url))

/**
 * Absolute path to the prebuilt SPA assets (the directory containing `index.html`).
 * `@decoy/ui` ships **static assets only** — this resolver is its sole
 * runtime export, letting `@decoy/server` lazily resolve and serve the panel with
 * `decoy start --ui`. `node/` (dev) and `dist/` (published) both sit one level
 * above `dist/client/`.
 */
export function uiAssetDir(): string {
  return join(here, '../dist/client')
}

/**
 * This package's version, read from its own `package.json`. `decoy start --ui`
 * compares it against the running `@decoy/server` to warn on a drift between the
 * separately-published panel and server (version-compat).
 */
export const version: string = JSON.parse(
  readFileSync(join(here, '../package.json'), 'utf8'),
).version
