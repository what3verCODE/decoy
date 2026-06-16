import { defineConfig } from '@decoy/config'

// The panel's same-origin control API, faked for the e2e exactly the way an adopter
// fakes their own app's API: a decoy.config + mocks/ (ADR-0007), loaded by
// @decoy/playwright over `page.route`. No server boots — @decoy/ui ships static assets
// only (ADR-0017) — so the server-only fields (`name`, `port`) are omitted; the router
// surface needs just the mock sources. The e2e fixture only registers the router
// (see e2e/fixtures.ts).
export default defineConfig({
  routesDir: './e2e/mocks/routes',
  collectionsFile: './e2e/mocks/collections.yaml',
  defaultCollection: 'default',
})
