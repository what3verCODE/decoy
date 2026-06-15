import { defineConfig } from '@rsbuild/core'
import { pluginPreact } from '@rsbuild/plugin-preact'

// Builds the prebuilt SPA assets into dist/client (UnoCSS runs via postcss.config.mjs).
// The @decoy/ui asset resolver (node/index.ts) points `decoy start --ui` here.
export default defineConfig({
  plugins: [pluginPreact()],
  source: { entry: { index: './client/main.tsx' } },
  html: { template: './client/index.html' },
  output: {
    distPath: { root: 'dist/client' },
    cleanDistPath: true,
  },
  server: { port: 5173 },
})
