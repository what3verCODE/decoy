import { defineConfig } from '@rslib/core'

// Builds only the Node asset resolver (node/index.ts). The SPA is built separately
// by rsbuild into dist/client — so `cleanDistPath` is off here to avoid wiping it.
export default defineConfig({
  source: { entry: { index: './node/index.ts' }, tsconfigPath: './tsconfig.node.json' },
  output: { cleanDistPath: false },
  lib: [
    { format: 'esm', syntax: 'es2023', dts: true },
    { format: 'cjs', syntax: 'es2023' },
  ],
})
