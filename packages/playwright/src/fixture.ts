import type { PlaywrightRoutable } from './playwright-types'
import {
  createPlaywrightRouter,
  type PlaywrightRouter,
  type PlaywrightRouterOptions,
} from './router'

/** The Playwright fixture argument the router binds to (a `BrowserContext`). */
export interface RouterFixtureArgs {
  context: PlaywrightRoutable
}

/** Playwright's fixture `use` callback. */
export type Use<T> = (value: T) => Promise<void>

/** A Playwright fixture function: `async ({ context }, use) => { … }`. */
export type RouterFixture = (args: RouterFixtureArgs, use: Use<PlaywrightRouter>) => Promise<void>

/**
 * Build a Playwright fixture that installs a {@link PlaywrightRouter} on each
 * test's `context` and tears it down afterwards. The mocks come from the project's
 * `decoy.config.*` (ADR-0007); with no options it is discovered from
 * `process.cwd()`. Because every Playwright context gets its own router (its own
 * selection), parallel tests are isolated for free — no standalone server. Plug it
 * into `test.extend`:
 *
 * ```ts
 * export const test = base.extend<{ router: PlaywrightRouter }>({
 *   router: createRouterFixture(),
 * })
 * ```
 *
 * Playwright types are referenced via `import type` only (a required peer dependency),
 * so this package carries no Playwright *runtime* dependency.
 */
export function createRouterFixture(options: PlaywrightRouterOptions = {}): RouterFixture {
  return async ({ context }, use) => {
    const router = await createPlaywrightRouter(context, options)
    try {
      await use(router)
    } finally {
      await router.dispose()
    }
  }
}
