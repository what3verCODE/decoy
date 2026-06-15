# examples/express

Mount **`@decoy/express` as in-process middleware** in a real Express app. Matched routes are
served from mocks; everything else **falls through** to the app's own handlers. This is the
frontend/BFF-dev story — and because the mock runs *inside* the app, "start the client and the
mock" collapses to **starting one app**. There is no standalone server and no `/__decoy__`:
scenarios are switched in-process through the middleware's `control` handle.

## Run it

```sh
pnpm --filter @decoy-examples/express dev
```

`dev` loads this example's `decoy.config.ts`, builds an Express app with the Decoy middleware
mounted, and listens on **http://localhost:3002** (run from source via jiti, so no build step).

## Poke it with curl

Each step below proves one Decoy feature.

**A served variant** — the active `happy-path` collection maps `GET /users/{id}` to the `ada`
variant, served by the middleware before any host handler runs:

```sh
curl -s localhost:3002/users/42
# {"id":42,"name":"Ada"}
```

**Fall-through on a miss** — `/health` isn't mocked, so the middleware calls `next()` and the
app's *real* handler answers. Mock what you want; let the rest of the app run:

```sh
curl -s localhost:3002/health
# {"status":"ok","from":"host app"}
```

**No real API to leak to** — a route that is neither mocked nor handled falls through to the
host app's default `404`. In-process the middleware never fails closed with a `501` (that's the
standalone server's job); it falls through, and here nothing downstream answers — so no request
ever reaches a real backend, because there isn't one:

```sh
curl -si localhost:3002/orders
# HTTP/1.1 404 Not Found
```

**Switch the scenario in-process** — there's no `/__decoy__` here. A host route, a feature test, or
any in-process code calls `control.useCollection(...)` on the middleware to flip the scenario;
the next request sees it. The e2e drives exactly this (see `tests/`).

## What's here

- `decoy.config.ts` — the mocks' config (name, mock paths; `port` is just the `dev` port).
- `mocks/` — the contract: a `users-by-id` route with `ada`/`boom` variants, and
  `happy-path`/`error-state` collections to switch between.
- `app.ts` — builds the real Express app: `express.json()` → Decoy middleware → a real
  `/health` handler. Exposes the middleware's in-process `control`.
- `tests/` — the e2e: boots the app on an ephemeral port and asserts served variant, in-process
  collection switch, fall-through, and the host `404`. Run it with
  `pnpm --filter @decoy-examples/express test:e2e`.
