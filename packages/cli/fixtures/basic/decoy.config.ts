import { defineConfig } from '@decoy/config'

export default defineConfig({
  name: 'users',
  port: 0,
  routesDir: './mocks/routes',
  collectionsFile: './mocks/collections.yaml',
  defaultCollection: 'happy-path',
})
