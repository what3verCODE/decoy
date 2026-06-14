import { defineConfig } from '@decoy/config'

// The mocks this example embeds in a real NestJS app via @decoy/nest. There is no
// standalone server here — the module runs in-process, so `port` is only the fixed
// port the `dev` script's app listens on for a human to curl; the e2e harness boots
// the same app on an ephemeral port instead.
export default defineConfig({
  name: 'users',
  port: 3003,
  routesDir: './mocks/routes',
  collectionsFile: './mocks/collections.yaml',
  defaultCollection: 'happy-path',
})
