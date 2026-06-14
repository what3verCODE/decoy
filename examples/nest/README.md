# examples/nest

Wire **`@decoy/nest` as an in-process module** into a real NestJS app. Matched routes are served
from mocks; everything else **falls through** to the app's own controllers. This is the
backend/BFF-dev story in Nest's idiom — and because the mock runs *inside* the app, "start the
client and the mock" collapses to **starting one app**. There is no standalone server and no
`/admin`: scenarios are switched in-process through the module's exported `control` handle.

## Run it

```sh
pnpm --filter @decoy-examples/nest dev
```

`dev` loads this example's `decoy.config.ts`, builds a NestJS app with the Decoy module wired,
and listens on **http://localhost:3003**. The app is bundled to a runnable `dist/main.cjs` by
**Rspack** (the repo's bundler — see `rspack.config.mjs`), then run on plain Node.

## Poke it with curl

Each step below proves one Decoy feature.

**A served variant** — the active `happy-path` collection maps `GET /users/{id}` to the `ada`
variant, served by the module before any host controller runs:

```sh
curl -s localhost:3003/users/42
# {"id":42,"name":"Ada"}
```

**Fall-through on a miss** — `/health` isn't mocked, so the module calls `next()` and the app's
*real* controller answers. Mock what you want; let the rest of the app run:

```sh
curl -s localhost:3003/health
# {"status":"ok","from":"host app"}
```

**No real API to leak to** — a route that is neither mocked nor handled falls through to the
host app's default `404`. In-process the module never fails closed with a `501` (that's the
standalone server's job); it falls through, and here nothing downstream answers — so no request
ever reaches a real backend, because there isn't one:

```sh
curl -si localhost:3003/orders
# HTTP/1.1 404 Not Found
```

**Switch the scenario in-process** — there's no `/admin` here. A host provider, a feature test,
or any in-process code resolves the exported `control` (the `DECOY_CONTROL` token) and calls
`control.setCollection(...)` to flip the scenario; the next request sees it. The e2e drives
exactly this (see `tests/`).

## What's here

- `decoy.config.ts` — the mocks' config (name, mock paths; `port` is just the `dev` port).
- `mocks/` — the contract: a `users-by-id` route with `ada`/`boom` variants, and
  `happy-path`/`error-state` collections to switch between.
- `app.ts` — builds the real Nest app: `DecoyModule.forService(...)` + a real `/health`
  controller. Resolves the embedded `control` from the live container.
- `dev.ts` — the `dev` entry: loads the config, builds the app, listens on the fixed port.
- `rspack.config.mjs` — bundles `dev.ts` (+ the workspace `@decoy/*` TS sources and the Nest
  decorators) into a runnable `dist/main.cjs`; the framework peers stay external.
- `tests/` — the e2e: boots the app on an ephemeral port and asserts served variant, in-process
  collection switch, fall-through, and the host `404`. Run it with
  `pnpm --filter @decoy-examples/nest test:e2e`.
