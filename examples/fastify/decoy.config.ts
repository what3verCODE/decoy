import { defineConfig } from '@decoy/config'

// The mocks this example embeds in a real Fastify app via @decoy/fastify. There is
// no standalone server here — the plugin runs in-process, so `port` is only the fixed
// port the `dev` script's app listens on for a human to curl; the e2e harness boots
// the same app on an ephemeral port instead.
export default defineConfig({
  name: 'users',
  port: 3005,
  routesDir: './mocks/routes',
  collectionsFile: './mocks/collections.yaml',
  defaultCollection: 'happy-path',
})
