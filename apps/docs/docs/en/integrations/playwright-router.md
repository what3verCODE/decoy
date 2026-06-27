---
title: Playwright (router mode)
description: Fake the browser→API edge entirely in the browser with @decoy/playwright over page.route — no Decoy server, one isolated engine per browser context.
---

# Playwright (router mode)

Fake the **browser→API edge entirely in the browser**. A real SPA makes real `fetch` calls;
`@decoy/playwright` intercepts them over Playwright's own `page.route` and answers from your mock
definitions. **No Decoy server runs** — the engine lives inside the Playwright test process, one
isolated instance per browser context. This is the frontend-dev story: develop and test the UI
against contract scenarios without standing anything up.

## Install

```sh
npm install -D @decoy/playwright @decoy/config @playwright/test
```

The router loads its mocks straight from your `decoy.config.ts` (see
[Getting Started](/guide/start/getting-started)) — no in-code mock definitions.

## The `router` fixture

Extend Playwright's `test` with a `router` fixture built by `createRouterFixture`. The `url` option
selects which requests Decoy intercepts. Mark it `auto` so even tests that only observe the baseline
still run against the faked API:

```ts
// tests/fixtures.ts
import { createRouterFixture, type PlaywrightRouter } from '@decoy/playwright'
import { test as base } from '@playwright/test'

export const test = base.extend<{ router: PlaywrightRouter }>({
  router: [createRouterFixture({ url: /\/api\// }), { auto: true }],
})

export { expect } from '@playwright/test'
```

## Switch scenarios from a test

The `router` exposes the standard [Router](/guide/advanced/control-plane) verbs; each switch is seen
by the next request the SPA makes:

```ts
import { expect, test } from './fixtures'

test('switches the scenario the UI sees', async ({ page, router }) => {
  await page.goto('/')
  await page.getByTestId('load-user').click()
  await expect(page.getByTestId('status')).toHaveText('200')

  await router.useCollection('error-state')   // next request → 500
  await page.getByTestId('load-user').click()
  await expect(page.getByTestId('status')).toHaveText('500')

  await router.useRoute('users-by-id', 'default', 'boom')  // pin one route
  await router.reset()                                     // back to baseline
})
```

A miss fails closed (`501 + x-mock-miss`) the same as everywhere — your UI can surface it.

## Parallel isolation

The engine is per-context, so parallel tests never collide. For contexts you create by hand, build a
router directly with `createPlaywrightRouter` — flipping one context's scenario never leaks into
another:

```ts
import { createPlaywrightRouter } from '@decoy/playwright'

const context = await browser.newContext({ baseURL })
const router = await createPlaywrightRouter(context, { url: /\/api\// })
await router.useCollection('error-state')   // only this context moves
```

## Run it

`page.route` interception only exists inside Playwright, so there is **no dev mode** — the SPA is
faked only while the test runs. Point Playwright's `webServer` at your SPA's dev server so Playwright
starts and stops it for you:

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  use: { baseURL: 'http://localhost:5180' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: 'pnpm exec rsbuild dev',
    url: 'http://localhost:5180',
    reuseExistingServer: !process.env.CI,
  },
})
```

A real browser belongs in its own CI job — install the binary with
`playwright install --with-deps chromium` and run only this suite there, so your default test run
never boots a browser.

## Next steps

- [Playwright (server mode)](/integrations/playwright-server) — drive a live Decoy server with
  per-session isolation instead of in-browser interception.
- [Sessions & Scenarios](/guide/advanced/sessions-and-scenarios) — the isolation model.
- [Control plane](/guide/advanced/control-plane) — the Router abstraction behind every adapter.
