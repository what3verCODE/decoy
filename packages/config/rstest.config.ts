import { defineConfig } from '@rstest/core'

// `@decoy/*` workspace deps are resolved via their `source` export condition
// (TS `./src`) instead of the built `./dist` (the `default` condition), so this
// internal package's tests bundle sibling source and run without a prior `pnpm
// build`. rsbuild merges these names into its defaults; `source` is first in each
// package's exports, so plain `node` (no `source` active) still gets `dist`.
// (Examples deliberately omit this: their e2e runs against built packages.)
export default defineConfig({
  resolve: { conditionNames: ['source'] },
})
