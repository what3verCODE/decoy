import { defineConfig } from '@decoy/config'

// The fake users API this example's SPA calls. No server ever boots here: the
// definitions below are loaded in tests/ and driven into the browser over
// `page.route` by @decoy/playwright. `port` is therefore irrelevant (0 = ephemeral).
export default defineConfig({
  name: 'users-api',
  port: 0,
  routesDir: './mocks/routes',
  collectionsFile: './mocks/collections.yaml',
  defaultCollection: 'happy-path',
})
