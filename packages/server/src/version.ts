import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Computed dynamically (not `new URL('../package.json', …)`) so bundlers don't
// rewrite the JSON into an emitted asset — this resolves to the real package.json
// at runtime from source (dev), the published dist build, and under the test runner.
const here = dirname(fileURLToPath(import.meta.url))

/**
 * The running `@decoy/server` version, read from its own `package.json`.
 * `decoy start --ui` compares it against the separately published `@decoy/ui` to
 * warn on a version drift (version-compat).
 */
export const version: string = JSON.parse(
  readFileSync(join(here, '../package.json'), 'utf8'),
).version
