import { defineConfig } from '@rsbuild/core'
import { pluginPreact } from '@rsbuild/plugin-preact'

// A standalone SPA. The pure, zero-IO @decoy/core engine bundles straight in and runs
// in the browser, so the playground needs no server and deploys as static files.
export default defineConfig({
  plugins: [pluginPreact()],
  source: {
    entry: { index: './src/main.tsx' },
    tsconfigPath: './tsconfig.json',
  },
  html: { template: './src/index.html', title: 'Decoy Playground' },
  output: { distPath: { root: 'dist' }, cleanDistPath: true },
  server: { port: 5174 },
})
