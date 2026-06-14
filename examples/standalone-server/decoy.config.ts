import { defineConfig } from '@decoy/config'

// The standalone Decoy server this example runs: it impersonates a users API. The
// `decoy` CLI boots it on this fixed port for `dev` (curl it by hand); the e2e
// harness overrides the port to 0 so parallel test runs bind ephemeral ports.
export default defineConfig({
  name: 'users',
  port: 3001,
  routesDir: './mocks/routes',
  collectionsFile: './mocks/collections.yaml',
  defaultCollection: 'happy-path',
})
