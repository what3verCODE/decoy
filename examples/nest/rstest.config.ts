import { defineConfig } from '@rstest/core'

// The e2e (tests/) boots a real NestJS app, whose decorators (@Module/@Controller/
// @Get) are TypeScript's legacy decorators and rely on emitted parameter metadata.
// `version: 'legacy'` makes the underlying SWC transform enable both `legacyDecorator`
// and `decoratorMetadata` — mirroring packages/nest's own rstest config.
export default defineConfig({
  source: {
    decorators: { version: 'legacy' },
  },
})
