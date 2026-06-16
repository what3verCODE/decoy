import { defineConfig } from '@decoy/config'

// A sqlite request-log store with a templated path, exercising boot-time resolution
// (`{name}` expands; the absolute path resolves against this config's dir) (#70).
export default defineConfig({
  name: 'users',
  port: 4201,
  routesDir: '../defaults/mocks/routes',
  collectionsFile: '../defaults/mocks/collections.yaml',
  defaultCollection: 'happy-path',
  requestLog: {
    store: 'sqlite',
    path: 'var/{name}.sqlite',
    retention: { maxRows: 500 },
    cleanup: 'on-exit',
  },
})
