import { defineConfig } from '@playwright/test'

// Real Chromium drives the SPA, which makes real `fetch` calls to a live Decoy
// server. Unlike the router example there is no `webServer` here: the e2e harness
// (tests/fixtures.ts) boots the SPA + Decoy per worker on ephemeral ports, so
// `baseURL` is set by the worker fixture rather than statically.
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
})
