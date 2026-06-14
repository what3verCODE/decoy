# examples/playwright-server

Fake the **browser→API edge against a live server**. A real SPA (served by Rsbuild) makes real
`fetch` calls to a **standalone [Decoy](../../packages/server) server**; real Chromium
(`@playwright/test`) drives the UI. Scenario control runs over the server's
[`/admin`](../../packages/server) HTTP API, scoped per browser session via the
[`SessionRouter`](../../packages/control) and the `x-mock-session` header — so the headline demo
is **parallel session isolation**: one context switching its scenario does not leak into another.

This is the full-stack/integration persona: the SPA, the network hop, and the mock server are all
real — only the upstream is faked.

## Run it

```sh
# One command boots the SPA + a live Decoy server on fixed ports for you to poke:
pnpm --filter ./examples/playwright-server dev
```

It prints the SPA URL (open it) and the Decoy server URL. The SPA's `/api/*` calls are proxied to
the Decoy server. In `dev` the SPA uses the **global** session, so switch its scenario by curling
`/admin`:

```sh
curl -X POST localhost:3004/admin/collection -d '{"name":"error-state"}'   # then reload the SPA
curl -X POST localhost:3004/admin/collection -d '{"name":"happy-path"}'
```

```sh
# Drive it with real Chromium:
pnpm --filter ./examples/playwright-server test:e2e
```

> First run needs the browser binary once: `pnpm --filter ./examples/playwright-server exec playwright install chromium`.

## How it fits together

The SPA is transport-agnostic: it just does same-origin `fetch('/api/users/42')`. The Rsbuild dev
server **proxies `/api` to the live Decoy server**, so the browser stays single-origin (no CORS) and
the `x-mock-session` header rides through. Tests never touch the app's code to switch scenarios:

- `tests/fixtures.ts` boots one **stack per Playwright worker** (`stack.ts` → SPA + Decoy on
  ephemeral ports) and exposes a per-test `router` ([`createSessionRouter`](../../packages/control)).
- The `router` fixture creates an isolated server **session** and `stampOn`s the browser context, so
  every request the SPA makes carries that session's `x-mock-session` header automatically.

## What each test proves

The mock (`decoy.config.ts` + `mocks/`) defines one route, `GET /api/users/{id}`, with two variants
(`ada` → `200`, `boom` → `500`) and two collections (`happy-path`, `error-state`). The SPA's buttons
call `/api/users/42` and an unmocked `/api/unmocked`, rendering status + body into the DOM.

- **Served variant** — on `happy-path`, *Load user* renders `Ada` with status `200`.
- **Collection switch** — `router.useCollection('error-state')` makes the next request render `500`.
- **Single-route override + reset** — `router.useRoute('users-by-id', 'default', 'boom')` flips one
  route; `router.reset()` restores the baseline.
- **Fail-closed miss** — *Load unmocked route* hits a route with no mock and gets `501` plus
  `x-mock-miss: true`, surfaced in the UI.
- **Parallel session isolation** — two contexts each own a session; switching one to `error-state`
  does not leak into the other, though both hit the same server.

## CI

A real browser belongs in its own job: because this package declares `@playwright/test`, CI's
example discovery routes it to the dedicated browser job, which runs
`playwright install --with-deps chromium` and then this example's `test:e2e`. The default
`pnpm test` never boots a browser.
