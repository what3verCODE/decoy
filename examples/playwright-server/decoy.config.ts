import { defineConfig } from '@decoy/config'

// The live Decoy server this example runs — the fake users API the SPA calls.
// `dev` boots it on this fixed port (the SPA's Rsbuild dev server proxies
// `/api` → here); the e2e harness overrides the port to 0 so parallel Playwright
// workers each bind an ephemeral port and never collide.
export default defineConfig({
  name: 'users-api',
  port: 3004,
  routesDir: './mocks/routes',
  collectionsFile: './mocks/collections.yaml',
  defaultCollection: 'happy-path',
})
