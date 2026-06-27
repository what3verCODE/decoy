import { defineConfig } from '@decoy/config'

// The panel's same-origin control API, faked for the e2e exactly the way an adopter
// fakes their own app's API: a decoy.config + mocks/, loaded by
// @decoy/playwright over `page.route`. No server boots — @decoy/ui ships static assets
// only — so the server-only fields (`name`, `port`) are omitted; the router
// surface needs just the mock sources. The e2e fixture only registers the router
// (see e2e/fixtures.ts).
export default defineConfig({
  routesDir: './mocks/routes',
  collectionsFile: './mocks/collections.yaml',
  defaultCollection: 'default',
  // TODO: issue #87
  control: {
    prefix: '/__panel__',
  },
})
