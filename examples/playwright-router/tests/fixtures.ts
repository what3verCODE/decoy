import { createRouterFixture, type PlaywrightRouter } from '@decoy/playwright'
import { test as base } from '@playwright/test'

/**
 * `router` fixture: installs a {@link PlaywrightRouter} on the test's browser
 * context via the package's public {@link createRouterFixture}, so the fake API is
 * always active and each test gets its own isolated selection. The router loads its
 * mocks from `decoy.config.ts` itself — no in-code definitions. It is `auto` so even
 * tests that never touch the control handle (they just observe the baseline) still
 * run against the faked API; tests that switch scenarios request `router` by name.
 */
export const test = base.extend<{ router: PlaywrightRouter }>({
  router: [createRouterFixture({ url: /\/api\// }), { auto: true }],
})

export { expect } from '@playwright/test'
