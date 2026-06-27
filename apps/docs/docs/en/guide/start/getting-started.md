---
title: Getting Started
description: Install Decoy, author a first mock, and watch a request resolve to a variant — end to end in a few minutes.
---

# Getting Started

This page takes you from nothing to a running mock that answers a real HTTP request. By the
end you'll have pointed `curl` at Decoy and watched it return a response you authored — no
backend required.

## Install

Add the CLI and the config helper to your project:

```sh
npm install -D @decoy/cli @decoy/config
```

The `@decoy/cli` package ships the `decoy` bin (`decoy start`, `decoy check`); `@decoy/config`
gives you the typed `defineConfig` helper. Swap `npm` for `pnpm` or `yarn` to taste.

## Author a first mock

A mock is three small files: a **config** that says where the mocks live, one or more
**route** files describing an endpoint's responses, and a **collections** file bundling routes
into switchable scenarios.

Create the config — `decoy.config.ts`:

```ts
import { defineConfig } from '@decoy/config'

export default defineConfig({
  name: 'users',
  port: 3001,
  routesDir: './mocks/routes',
  collectionsFile: './mocks/collections.yaml',
  defaultCollection: 'happy-path',
})
```

Describe one endpoint — `mocks/routes/users.yaml`. The route declares its method and path, then
names **variants** (concrete responses):

```yaml
id: users-by-id
method: GET
path: /users/{id}
presets:
  default: {}
variants:
  ada:
    status: 200
    body:
      id: 42
      name: Ada
  boom:
    status: 500
    body:
      error: upstream exploded
```

Bundle variants into scenarios — `mocks/collections.yaml`. A **collection** maps each route to
the variant it should serve, so you can switch the whole scenario atomically:

```yaml
- id: happy-path
  routes:
    - users-by-id:default:ada
- id: error-state
  routes:
    - users-by-id:default:boom
```

## Run it

Boot the server from your config:

```sh
npx decoy start
```

Decoy comes up on **http://localhost:3001**, serving the `happy-path` collection (your
`defaultCollection`), with its `/__decoy__` control API on the same port.

## See a request resolve to a variant

Point any client's base URL at Decoy. The active `happy-path` collection maps `GET /users/{id}`
to the `ada` variant, so:

```sh
curl -s localhost:3001/users/42
# {"id":42,"name":"Ada"}
```

That response came from the variant you authored — the request matched the `users-by-id` route,
the active collection selected `ada`, and Decoy served it deterministically.

### Switch the scenario

Flip to the `error-state` collection over the control API; the next request sees the new
scenario:

```sh
curl -s -XPOST localhost:3001/__decoy__/collection -d '{"name":"error-state"}'
curl -s localhost:3001/users/42
# {"error":"upstream exploded"}   (HTTP 500)
```

### Fail-closed by default

A request with no matching mock never reaches a real backend — it returns `501` with an
`x-mock-miss` header, so a test can't silently pass by hitting production:

```sh
curl -si localhost:3001/orders
# HTTP/1.1 501 ...
# x-mock-miss: true
```

That fail-closed default is the property a test suite needs most: an unmatched request fails
loudly instead of leaking to the network.

## Check your config before running

`decoy check` validates the config and mocks without booting a server, exiting non-zero on any
error — useful as a CI gate:

```sh
npx decoy check
```

## Next steps

You have a running mock and have seen a request resolve to a variant. From here:

- [Core Concepts](/guide/basic/) — the Route → Preset → Variant → Collection model in depth.
- [Configuration](/guide/basic/) — every `defineConfig` option, fail-closed and passthrough.
- [Integrations](/integrations/) — mount Decoy in Express, Nest, Fastify, Playwright, or Testplane.
- [AI](/guide/start/ai) — point your AI tooling at Decoy's docs.
