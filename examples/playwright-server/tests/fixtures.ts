import { createSessionRouter, type SessionRouter } from '@decoy/control'
import { test as base } from '@playwright/test'
import { type RunningStack, startStack } from '../stack'

interface WorkerFixtures {
  /** The SPA + live Decoy server this worker drives (ephemeral ports). */
  stack: RunningStack
}

interface TestFixtures {
  /** A per-test server session the test drives to switch scenarios. */
  router: SessionRouter
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  // One stack per worker (SPA dev server + standalone Decoy server) on ephemeral
  // ports, so parallel workers never collide. Tests within a worker share its
  // Decoy server; per-test isolation rides the `router` session below.
  stack: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright passes fixtures positionally; this one has no deps
    async ({}, use) => {
      const stack = await startStack({ decoyPort: 0, spaPort: 0 })
      await use(stack)
      await stack.stop()
    },
    { scope: 'worker' },
  ],

  // Point Playwright's built-in baseURL (and so every context/page) at this
  // worker's SPA.
  baseURL: async ({ stack }, use) => {
    await use(stack.spaUrl)
  },

  // Per-test session: an isolated selection on the shared Decoy server, stamped
  // onto the browser context so the SPA's own `fetch`es reach it (no app changes).
  // `auto` so even a baseline-only test gets its own session and never stomps a
  // sibling running in the same worker.
  router: [
    async ({ stack, context }, use) => {
      const router = await createSessionRouter({ baseUrl: stack.decoyBaseUrl })
      await router.stampOn(context)
      await use(router)
      await router.destroy()
    },
    { auto: true },
  ],
})

export { expect } from '@playwright/test'
