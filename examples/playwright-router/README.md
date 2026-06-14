# examples/playwright-router

Fake the **browser→API edge entirely in the browser**. A real SPA (served by Rsbuild) makes
real `fetch` calls; [`@decoy/playwright`](../../packages/playwright) intercepts them over real
`page.route` and answers from the mock definitions. **No Decoy server runs** — the engine lives
inside the Playwright test process, one isolated instance per browser context.

This is the frontend-dev persona: you develop and test the UI against contract scenarios without
standing anything up.

## Run it

```sh
pnpm --filter ./examples/playwright-router test:e2e
```

That's the only command. There is no `dev` mode: `page.route` interception only exists inside
Playwright, so the SPA is faked only while the test runs. Playwright boots the Rsbuild dev server
(and tears it down) for you.

> First run needs the browser binary once: `pnpm --filter ./examples/playwright-router exec playwright install chromium`.

## What each test proves

The mock (`decoy.config.ts` + `mocks/`) defines one route, `GET /api/users/42`, with two variants
(`ada` → `200`, `boom` → `500`) and two collections (`happy-path`, `error-state`). The SPA's two
buttons call `/api/users/42` and an unmocked `/api/unmocked`, rendering status + body into the DOM.

- **Served variant** — on `happy-path`, clicking *Load user* renders `Ada` with status `200`.
- **Collection switch** — `router.useCollection('error-state')` makes the next request render the
  `500` error.
- **Single-route override + reset** — `router.useRoute('users-by-id', 'default', 'boom')` flips one
  route; `router.reset()` restores the baseline.
- **Fail-closed miss** — *Load unmocked route* hits a route with no mock and gets `501` plus the
  `x-mock-miss: true` header, surfaced in the UI.
- **Parallel isolation** — two browser contexts each own a router; switching one to `error-state`
  does not leak into the other.

Scenario control runs through the package's public surface: `createRouterFixture(...)` provides the
per-context `router` fixture (`tests/fixtures.ts`), and `createPlaywrightRouter(...)` builds the two
independent contexts in the isolation test.

## CI

A real browser belongs in its own job: CI installs Chromium with
`playwright install --with-deps chromium` and runs only this example's `test:e2e` there. The default
`pnpm test` never boots a browser.
