import { defineConfig } from '@rsbuild/core'
import { pluginPreact } from '@rsbuild/plugin-preact'

// Builds the prebuilt SPA assets into dist/client (UnoCSS runs via postcss.config.mjs).
// The @decoy/ui asset resolver (node/index.ts) points `decoy start --ui` here.
export default defineConfig({
  plugins: [pluginPreact()],
  source: { entry: { index: './client/main.tsx' }, tsconfigPath: './tsconfig.client.json' },
  html: { template: './client/index.html' },
  output: {
    distPath: { root: 'dist/client' },
    cleanDistPath: true,
  },
  server: {
    port: 5173,
    // Dev only: the SPA fetches its control API same-origin (`/__decoy__/*`), so
    // proxy those to the `pnpm dev:server` Decoy on :4000 (decoy.config.ts port).
    // `ws: true` keeps the live request-log SSE stream (GET /__decoy__/logs) open.
    // The published build serves SPA + control from one origin, so no proxy ships.
    proxy: {
      '/__decoy__': {
        target: 'http://localhost:4000',
        ws: true,
      },
    },
  },
})
