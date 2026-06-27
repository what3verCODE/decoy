---
title: Standalone server (CLI)
description: Run Decoy as a process in front of an upstream with the decoy CLI, and switch scenarios over the /__decoy__ HTTP control API.
---

# Standalone server (CLI)

Run Decoy as its own process — the `decoy` CLI boots a server you point a base URL at, instead of a
live upstream. Any non-browser client (another service, a backend test, `curl`) talks to it over
HTTP, and you switch scenarios over the [`/__decoy__`](/guide/advanced/control-plane) control API on
the same port. This is the backend/full-stack dev story: develop against deterministic mocks with no
real backend running.

## Install

```sh
npm install -D @decoy/cli @decoy/config
```

`@decoy/cli` ships the `decoy` bin (`decoy start`, `decoy check`); `@decoy/config` gives you the
typed `defineConfig` helper.

## Configure

A standalone server is just a config plus a `mocks/` directory — see
[Getting Started](/guide/start/getting-started) for the mock files. The `port` is fixed here because
the server owns the process:

```ts
// decoy.config.ts
import { defineConfig } from '@decoy/config'

export default defineConfig({
  name: 'users',
  port: 3001,
  routesDir: './mocks/routes',
  collectionsFile: './mocks/collections.yaml',
  defaultCollection: 'happy-path',
})
```

## Run it

```sh
npx decoy start
```

Decoy comes up on **http://localhost:3001**, serving the `happy-path` collection (your
`defaultCollection`), with its `/__decoy__` control API on the same port. Point any client's base
URL at it:

```sh
curl -s localhost:3001/users/42
# {"id":42,"name":"Ada"}
```

## Switch scenarios over `/__decoy__`

Because the server is a separate process, you drive it over its HTTP control mirror. Each switch is
atomic — the *next* request sees the new state:

```sh
# Swap the whole scenario
curl -s -XPOST localhost:3001/__decoy__/collection -d '{"name":"error-state"}'
curl -s localhost:3001/users/42
# {"error":"upstream exploded"}   (HTTP 500)

# Pin a single route, then drop overrides back to the collection baseline
curl -s -XPOST localhost:3001/__decoy__/route -d '{"route":"users-by-id","preset":"default","variant":"boom"}'
curl -s -XPOST localhost:3001/__decoy__/reset
```

From test code, prefer the typed client over hand-rolled `fetch` — each call resolves with the
resulting selection, and an unknown collection/route fails loud:

```ts
import { createControlClient } from '@decoy/control'

const control = createControlClient({ baseUrl: 'http://localhost:3001' })
await control.useCollection('error-state')
```

## Fail-closed by default

A request with no matching mock never reaches a real backend — it returns `501` with an
`x-mock-miss` header, so a test can't silently pass by hitting production:

```sh
curl -si localhost:3001/orders
# HTTP/1.1 501 Not Implemented
# x-mock-miss: true
```

## Next steps

- [Control plane](/guide/advanced/control-plane) — the full `/__decoy__` API and the typed client.
- [Playwright (server mode)](/integrations/playwright-server) — drive this server from browser tests
  with per-session isolation.
- [Configuration](/guide/basic/configuration) — every `defineConfig` option.
