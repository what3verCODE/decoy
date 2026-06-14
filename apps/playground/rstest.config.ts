import { defineConfig } from '@rstest/core'

// The nest e2e (nest-module.e2e.test.ts) boots a real NestJS app, whose decorators
// (@Module/@Controller/@Inject) are TypeScript's legacy decorators and rely on
// emitted parameter metadata for constructor injection. `version: 'legacy'` makes
// the underlying SWC transform enable both `legacyDecorator` and `decoratorMetadata`.
// The other e2e slices use no decorators, so this is a no-op for them.
export default defineConfig({
  source: {
    decorators: { version: 'legacy' },
  },
})
