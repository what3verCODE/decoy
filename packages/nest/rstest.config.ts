import { defineConfig } from '@rstest/core'

// The integration test (integration.test.ts) boots a real NestJS app, whose
// decorators (@Module/@Controller/@Get/@Post) are TypeScript's legacy decorators
// and rely on emitted parameter metadata. `version: 'legacy'` makes the underlying
// SWC transform enable both `legacyDecorator` and `decoratorMetadata`. The unit
// tests use structural fakes (no decorators), so this is a no-op for them.
export default defineConfig({
  source: {
    decorators: { version: 'legacy' },
  },
})
