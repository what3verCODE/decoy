import { defineConfig } from '@decoy/config'

// Otherwise valid (reuses the basic fixture's mocks), but the requestLog filename
// template carries unknown tokens — `decoy check` must reject and name them (#70).
export default defineConfig({
  name: 'users',
  port: 0,
  routesDir: '../basic/mocks/routes',
  collectionsFile: '../basic/mocks/collections.yaml',
  defaultCollection: 'happy-path',
  requestLog: {
    store: 'sqlite',
    path: '.decoy/{bogus}-%Q.sqlite',
  },
})
