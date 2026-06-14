import { defineConfig } from '@decoy/config'

// The playground's Decoy instance: it impersonates the upstream users API the
// example app (src/app.ts) calls. Port 0 lets the harness bind an ephemeral port.
export default defineConfig({
  name: 'users',
  port: 0,
  routesDir: './mocks/routes',
  collectionsFile: './mocks/collections.yaml',
  defaultCollection: 'happy-path',
})
