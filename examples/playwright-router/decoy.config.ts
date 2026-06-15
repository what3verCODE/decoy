import { defineConfig } from '@decoy/config'

// The fake users API this example's SPA calls. No server ever boots here: the mocks
// below are loaded in tests/ and driven into the browser over `page.route` by
// @decoy/playwright, so the server-only fields (`name`, `port`) are omitted.
export default defineConfig({
  routesDir: './mocks/routes',
  collectionsFile: './mocks/collections.yaml',
  defaultCollection: 'happy-path',
})
