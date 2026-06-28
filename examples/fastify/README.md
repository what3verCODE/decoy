# examples/fastify

Register **`@decoy/fastify` as an in-process plugin** in a real Fastify app. Matched routes are
served from mocks; a miss for a path a real route owns **falls through** to that route; and a
request nothing owns **fails closed** (`501 + x-mock-miss`). This is the backend-dev story in
Fastify's idiom — and because the mock runs *inside* the app, "start the client and the mock"
collapses to **starting one app**. There is no standalone server and no `/__decoy__`: scenarios are
switched in-process through the plugin's `control` handle.

## Run it

```sh
pnpm --filter @decoy-examples/fastify dev
```

`dev` loads this example's `decoy.config.ts`, builds a Fastify app with the Decoy plugin
registered, and listens on **http://localhost:3005**. It runs from source via **jiti** with no
build step: fastify has no decorators and the example owns its entrypoint, so jiti transpiles the
`@decoy/*` TS-source imports and loads fastify from `node_modules` directly — no bundler needed
(unlike `examples/nest`, whose Rspack step exists for `nest start` + legacy decorators).

## Poke it with curl

Each step below proves one Decoy feature.

**A served variant** — the active `happy-path` collection maps `GET /users/{id}` to the `ada`
variant, served by the plugin's `preHandler` hook before any host route runs:

```sh
curl -s localhost:3005/users/42
# {"id":42,"name":"Ada"}
```

**Fall-through on a miss** — `/health` isn't mocked but a real route owns it, so the plugin's
hook misses, the request continues, and the app's *real* handler answers. Mock what you want; let
the rest of the app run:

```sh
curl -s localhost:3005/health
# {"status":"ok","from":"host app"}
```

**Fail closed when nothing answers** — a route that is neither mocked nor owned by a real route
lands in the plugin's not-found handler and fails closed with `501 + x-mock-miss`. No
request ever reaches a real backend, because there isn't one — that is the whole point of the
mock:

```sh
curl -si localhost:3005/orders
# HTTP/1.1 501 Not Implemented
# x-mock-miss: true
```

**Switch the scenario in-process** — there's no `/__decoy__` here. A host route, a feature test, or
any in-process code calls `control.useCollection(...)` on the plugin to flip the scenario; the
next request sees it. The e2e drives exactly this (see `tests/`).

## What's here

- `decoy.config.ts` — the mocks' config (name, mock paths; `port` is just the `dev` port).
- `mocks/` — the contract: a `users-by-id` route with `ada`/`boom` variants, and
  `happy-path`/`error-state` collections to switch between.
- `app.ts` — builds the real Fastify app: register the Decoy plugin → a real `/health` route.
  Exposes the plugin's in-process `control`.
- `tests/` — the e2e: boots the app on an ephemeral port and asserts served variant, in-process
  collection switch, fall-through, and the fail-closed `501`. Run it with
  `pnpm --filter @decoy-examples/fastify test:e2e`.
