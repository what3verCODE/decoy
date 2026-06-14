import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type LoadedService, loadConfig } from '@decoy/config'
import { createRouterFixture, type PlaywrightRouter } from '@decoy/playwright'
import { test as base } from '@playwright/test'

const here = dirname(fileURLToPath(import.meta.url))
const configPath = resolve(here, '../decoy.config.ts')

// Load the example's own decoy.config.ts once, lazily (avoids top-level await in a
// fixture module). The same definitions feed every router/context.
let cached: Promise<LoadedService> | undefined
export function loadService(): Promise<LoadedService> {
  cached ??= loadConfig({ configPath })
  return cached
}

// Only `/api/*` is faked; everything else (the SPA's own HTML/JS) loads from the
// Rsbuild dev server untouched.
export const API_URL = /\/api\//

/**
 * `router` fixture: installs a {@link PlaywrightRouter} on the test's browser
 * context via the package's public {@link createRouterFixture}, so the fake API is
 * always active and each test gets its own isolated selection. It is `auto` so even
 * tests that never touch the control handle (they just observe the baseline) still
 * run against the faked API; tests that switch scenarios request `router` by name.
 */
export const test = base.extend<{ router: PlaywrightRouter }>({
  router: [
    async ({ context }, use) => {
      const service = await loadService()
      const fixture = createRouterFixture({
        definitions: service.definitions,
        defaultCollection: service.defaultCollection,
        url: API_URL,
      })
      await fixture({ context }, use)
    },
    { auto: true },
  ],
})

export { expect } from '@playwright/test'
