import { defineConfig } from '@rslib/core'

export default defineConfig({
  source: { entry: { index: './src/index.ts', bin: './src/bin.ts' } },
  // `@decoy/ui` is an optional, lazily-imported peer (`() => import('@decoy/ui')`,
  // only when `--ui` is passed) — keep it external so the cli builds without the UI's
  // dist present. This also breaks the cli↔ui workspace build-order cycle (@decoy/ui
  // dev-depends on @decoy/cli for its `dev:server` script).
  output: { externals: ['@decoy/ui'] },
  lib: [
    { format: 'esm', syntax: 'es2023', dts: true },
    { format: 'cjs', syntax: 'es2023' },
  ],
})
