---
title: Fastify
description: Register @decoy/fastify as an in-process plugin — serve mocks, fall through to real routes on a miss, fail closed when nothing answers.
---

# Fastify

Register `@decoy/fastify` as a plugin in a real Fastify app. A `preHandler` hook serves matched
routes from their variants; a miss for a path a **real route owns** falls through to that route; and
a request **nothing owns** fails closed with `501 + x-mock-miss`. The mock runs *in process*, so
"start the client and the mock" collapses to starting one app — there is no standalone server and no
`/__decoy__`. Scenarios are switched through the plugin's in-process `control` handle.

## Install

```sh
npm install @decoy/fastify @decoy/config fastify
```

You author the same `decoy.config.ts` + `mocks/` as everywhere else (see
[Getting Started](/guide/start/getting-started)); here `port` is only the port your own app listens
on.

## Register the plugin

Load the config into a `LoadedService`, build the plugin with `fromService`, and `register` it.
`fromService` returns a plugin you `await app.register(...)`:

```ts
import { loadConfig } from '@decoy/config'
import { fromService } from '@decoy/fastify'
import Fastify from 'fastify'

const service = await loadConfig({ configPath: './decoy.config.ts' })
const decoy = fromService(service)

const app = Fastify()
await app.register(decoy)

// A real host route — reached only when Decoy misses and the request falls through.
app.get('/health', (_request, reply) => {
  reply.send({ status: 'ok', from: 'host app' })
})

await app.ready()
await app.listen({ port: service.port })
```

```sh
curl -s localhost:3005/users/42   # mocked variant (happy-path)
# {"id":42,"name":"Ada"}
curl -s localhost:3005/health     # real host route (fall-through)
# {"status":"ok","from":"host app"}
```

## Switch scenarios in-process

There's no `/__decoy__` here — `decoy.control` is the in-process [Controller](/guide/advanced/control-plane).
Call it from a host route, a feature test, or any in-process code; the next request sees the switch:

```ts
decoy.control.useCollection('error-state')
// → GET /users/42 now serves the 500 variant
decoy.control.useCollection('happy-path')   // back to baseline
```

## Fail closed when nothing answers

Unlike Express's pure fall-through, a request that is neither mocked nor owned by a real route lands
in the plugin's not-found handler and **fails closed** — this rides Fastify's natural lifecycle:

```sh
curl -si localhost:3005/orders
# HTTP/1.1 501 Not Implemented
# x-mock-miss: true
```

A path a real route owns still falls through to that route; only the genuinely-unhandled request
fails closed. Either way nothing reaches a real API, because there isn't one.

## Next steps

- [Control plane](/guide/advanced/control-plane) — the in-process `control` verbs.
- [Express](/integrations/express) — the same in-process story, pure fall-through (no `501`).
- [Configuration](/guide/basic/configuration) — every `defineConfig` option.
