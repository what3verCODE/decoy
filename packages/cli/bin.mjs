#!/usr/bin/env node
// Stable, committed launcher for the `decoy` bin.
//
// pnpm links bins during `install`, BEFORE any build runs. If `bin` pointed
// straight at `./dist/bin.js` (a build artifact), the symlink couldn't be
// created on a fresh checkout — forcing the `pnpm i` -> `pnpm build` -> `pnpm i`
// dance. This file always exists, so the symlink is created on the first
// install; it just delegates to the built output.
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const dist = new URL('./dist/bin.js', import.meta.url)
if (!existsSync(fileURLToPath(dist))) {
  console.error(
    '[decoy] CLI not built yet — run `pnpm build` (or `pnpm --filter @decoy/cli build`).',
  )
  process.exit(1)
}
await import(dist)
