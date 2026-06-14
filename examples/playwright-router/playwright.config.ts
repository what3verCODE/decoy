import { defineConfig } from '@playwright/test'
import { BASE_URL } from './tests/constants'

// Real Chromium drives the SPA; @decoy/playwright fakes the API over page.route.
// The SPA itself is served by Rsbuild, which Playwright starts and stops for us.
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  use: {
    baseURL: BASE_URL,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: 'pnpm exec rsbuild dev',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
