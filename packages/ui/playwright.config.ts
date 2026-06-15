import { defineConfig } from '@playwright/test'

// Real Chromium loads the prebuilt SPA served statically by `rsbuild preview`; the
// data API is stubbed per-test in the browser (e2e/fixtures.ts), so no server is
// booted. Run `pnpm --filter @decoy/ui build` first so dist/spa exists.
const PORT = 4180

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  use: { baseURL: `http://localhost:${PORT}` },
  webServer: {
    command: `pnpm exec rsbuild preview --port ${PORT}`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
})
