# examples/standalone-server

Run **Decoy as a standalone server** with the `decoy` CLI, then drive scenarios from any
non-browser client (here: `curl`) over the **`/__decoy__`** HTTP control API. This is the
backend-dev story: point a base URL at Decoy and develop against deterministic mocks instead
of a live upstream.

## Run it

```sh
pnpm --filter @decoy-examples/standalone-server dev
```

`dev` invokes the `decoy` CLI's `start` against this example's `decoy.config.ts` (run from
source via jiti, so no build step is needed — the published package ships it as the `decoy`
bin: `decoy start`). The server comes up on **http://localhost:3001**, with its `/__decoy__`
control API on the same port.

## Poke it with curl

Each step below proves one Decoy feature.

**A served variant** — the active `happy-path` collection maps `GET /users/{id}` to the `ada`
variant:

```sh
curl -s localhost:3001/users/42
# {"id":42,"name":"Ada"}
```

**Switch the scenario over `/__decoy__`** — flip to the `error-state` collection; the *next*
request sees the new scenario:

```sh
curl -s -XPOST localhost:3001/__decoy__/collection -d '{"name":"error-state"}'
curl -s localhost:3001/users/42
# {"error":"upstream exploded"}   (HTTP 500)
```

**Pin a single route, then reset** — override just one route, then clear overrides back to the
collection's baseline:

```sh
curl -s -XPOST localhost:3001/__decoy__/route -d '{"route":"users-by-id","preset":"default","variant":"boom"}'
curl -s -XPOST localhost:3001/__decoy__/reset
curl -s localhost:3001/users/42
# {"id":42,"name":"Ada"}   (back to happy-path)
```

**Fail-closed miss** — a route with no mock never reaches a real backend; it returns
`501` with an `x-mock-miss` header so a test can't silently pass:

```sh
curl -si localhost:3001/orders
# HTTP/1.1 501 ...
# x-mock-miss: true
```

## What's here

- `decoy.config.ts` — the standalone server's config (name, fixed port, mock paths).
- `mocks/` — the contract: a `users-by-id` route with `ada`/`boom` variants, and
  `happy-path`/`error-state` collections to switch between.
- `tests/` — the e2e: boots the server via the CLI on an ephemeral port and asserts the four
  steps above end-to-end. Run it with `pnpm --filter @decoy-examples/standalone-server test:e2e`.
