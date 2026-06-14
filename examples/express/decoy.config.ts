import { defineConfig } from '@decoy/config'

// The mocks this example embeds in a real Express app via @decoy/express. There is
// no standalone server here — the middleware runs in-process, so `port` is only the
// fixed port the `dev` script's app listens on for a human to curl; the e2e harness
// boots the same app on an ephemeral port instead.
export default defineConfig({
  name: 'users',
  port: 3002,
  routesDir: './mocks/routes',
  collectionsFile: './mocks/collections.yaml',
  defaultCollection: 'happy-path',
})
