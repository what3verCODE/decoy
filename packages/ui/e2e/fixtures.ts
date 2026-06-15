import { createRouterFixture, type PlaywrightRouter } from '@decoy/playwright'
import { test as base } from '@playwright/test'

// Dogfood (ADR-0017): the panel's same-origin control API is faked the way an adopter
// fakes their own app's API — a decoy.config.ts + mocks/ at the package root, loaded
// by @decoy/playwright (ADR-0007). Registering the fixture is the whole setup: the
// router discovers the config from cwd and serves the baseline `default` collection.
// Tests that need an empty state pin a route's `empty` variant via the `router`
// handle. Scoped to /__decoy__/** so the SPA's own assets load from the preview server
// untouched; @decoy/ui ships static assets only, so the e2e never boots a server.
export const test = base.extend<{ router: PlaywrightRouter }>({
  router: [createRouterFixture({ url: '**/__decoy__/**' }), { auto: true }],
})

export { expect } from '@playwright/test'
