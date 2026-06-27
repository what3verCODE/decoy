---
title: Playwright (server mode)
description: Drive a live Decoy server from Playwright with per-session isolation — real SPA, real network hop, parallel workers that never leak into each other.
---

# Playwright (server mode)

Fake the **browser→API edge against a live server**. A real SPA makes real `fetch` calls to a
standalone Decoy server; real Chromium drives the UI. Scenario control runs over the server's
[`/__decoy__`](/guide/advanced/control-plane) HTTP API, **scoped per browser session** via the
`SessionRouter` and the `x-mock-session` header — so the headline is **parallel session isolation**:
one context switching its scenario never leaks into another, even though both hit the same server.
This is the full-stack/integration story: the SPA, the network hop, and the mock server are all real;
only the upstream is faked.

## Install

```sh
npm install -D @decoy/control @decoy/cli @decoy/server @decoy/config @playwright/test
```

Use `@decoy/control` for the session router, and the [standalone server](/integrations/standalone)
(`@decoy/cli` + `@decoy/server`) for the live Decoy process the SPA talks to.

## Keep the browser single-origin

The SPA does ordinary same-origin `fetch('/api/users/42')`. Point your dev server's proxy at the
live Decoy server so `/api/*` is forwarded there: the browser stays single-origin (no CORS) and the
`x-mock-session` header rides through transparently — no application code changes. With Rsbuild:

```ts
server: {
  proxy: { '/api': decoyBaseUrl },   // forward the SPA's /api/* to the live Decoy server
}
```

## Per-session fixtures

Boot one stack (SPA dev server + Decoy server) per worker, and mint an isolated **session** per
test. `stampOn(context)` stamps the session header onto the browser context, so every request the
SPA makes carries it automatically:

```ts
// tests/fixtures.ts
import { createSessionRouter, type SessionRouter } from '@decoy/control'
import { test as base } from '@playwright/test'
import { type RunningStack, startStack } from '../stack'

export const test = base.extend<{ router: SessionRouter }, { stack: RunningStack }>({
  // One stack per worker, on ephemeral ports — parallel workers never collide.
  stack: [async ({}, use) => {
    const stack = await startStack({ decoyPort: 0, spaPort: 0 })
    await use(stack)
    await stack.stop()
  }, { scope: 'worker' }],

  baseURL: async ({ stack }, use) => { await use(stack.spaUrl) },

  // Per-test session: an isolated selection on the shared server, stamped onto the
  // browser context. `auto` so even a baseline-only test gets its own session.
  router: [async ({ stack, context }, use) => {
    const router = await createSessionRouter({ baseUrl: stack.decoyBaseUrl })
    await router.stampOn(context)
    await use(router)
    await router.destroy()
  }, { auto: true }],
})

export { expect } from '@playwright/test'
```

## Switch scenarios — only your session moves

The `router` is a [SessionRouter](/guide/advanced/sessions-and-scenarios): the same
`useCollection` / `useRoute` / `reset` verbs, scoped to this test's session:

```ts
import { expect, test } from './fixtures'

test('switches the scenario the UI sees', async ({ page, router }) => {
  await page.goto('/')
  await router.useCollection('error-state')   // only THIS session moves
  await page.getByTestId('load-user').click()
  await expect(page.getByTestId('status')).toHaveText('500')
})
```

Two contexts each owning a session stay isolated on the same live server — flip one to `error-state`
and the other still serves the happy path. One shared server scales to massive parallelism with zero
extra processes; see [Sessions & Scenarios](/guide/advanced/sessions-and-scenarios).

## Run it

Boot the SPA + a live Decoy server on fixed ports to poke by hand; in `dev` the SPA uses the
**global** session, so switch its scenario by curling `/__decoy__`:

```sh
curl -X POST localhost:3004/__decoy__/collection -d '{"name":"error-state"}'   # then reload the SPA
```

Drive it with real Chromium via `playwright test`. As with router mode, a real browser belongs in
its own CI job (`playwright install --with-deps chromium`), kept out of the default test run.

## Next steps

- [Sessions & Scenarios](/guide/advanced/sessions-and-scenarios) — the isolation model in depth.
- [Standalone server (CLI)](/integrations/standalone) — the live server this drives.
- [Playwright (router mode)](/integrations/playwright-router) — in-browser interception, no server.
