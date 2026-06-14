import { defineConfig } from '@rsbuild/core'
import { PORT } from './tests/constants'

// Serves the SPA (src/) during `test:e2e`. Playwright boots this dev server via its
// `webServer` config; there is no standalone `dev` script (this example is test-only —
// `page.route` interception only exists inside Playwright).
export default defineConfig({
  source: { entry: { index: './src/main.ts' } },
  html: { template: './src/index.html' },
  server: { port: PORT },
})
