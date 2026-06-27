---
title: Express
description: Mount @decoy/express as in-process middleware — serve mocks, fall through to your real handlers on a miss, and switch scenarios in-process.
---

# Express

Mount `@decoy/express` as middleware in a real Express app. A request that matches a mocked route is
served from its variant; a miss calls `next()` and **falls through** to your app's own handlers. The
mock runs *in process*, so "start the client and the mock" collapses to starting one app — there is
no standalone server and no `/__decoy__`. Scenarios are switched through the middleware's in-process
`control` handle.

## Install

```sh
npm install @decoy/express @decoy/config express
```

You author the same `decoy.config.ts` + `mocks/` as everywhere else (see
[Getting Started](/guide/start/getting-started)); here `port` is only the port your own app listens
on.

## Mount the middleware

Load the config into a `LoadedService`, build the middleware with `fromService`, and `app.use` it.
Put a body parser **before** Decoy so `body:` matchers can see the payload:

```ts
import { loadConfig } from '@decoy/config'
import { fromService } from '@decoy/express'
import express from 'express'

const service = await loadConfig({ configPath: './decoy.config.ts' })
const decoy = fromService(service)

const app = express()
app.use(express.json())   // before Decoy, so body matchers see the payload
app.use(decoy)

// A real host route — reached only when Decoy misses and falls through.
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', from: 'host app' })
})

app.listen(service.port)
```

```sh
curl -s localhost:3002/users/42   # mocked variant (happy-path)
# {"id":42,"name":"Ada"}
curl -s localhost:3002/health     # real host handler (fall-through)
# {"status":"ok","from":"host app"}
```

## Switch scenarios in-process

There's no `/__decoy__` here — `decoy.control` is the in-process [Controller](/guide/advanced/control-plane).
A host route, a feature test, or any in-process code calls it directly; the next request sees the
switch:

```ts
decoy.control.useCollection('error-state')
// → GET /users/42 now serves the 500 variant
decoy.control.useCollection('happy-path')   // back to baseline
```

## Misses fall through — no fail-closed 501

In-process the middleware never fails closed with a `501` (that's the standalone server's job). A
route that is neither mocked nor handled falls through to the host app's default `404`:

```sh
curl -si localhost:3002/orders
# HTTP/1.1 404 Not Found
```

Nothing reaches a real API, because there isn't one — that's the whole point of the embedded mock.
If you need a hard `501 + x-mock-miss` boundary, use the
[standalone server](/integrations/standalone) or [Fastify](/integrations/fastify) instead.

## Next steps

- [Control plane](/guide/advanced/control-plane) — the in-process `control` verbs.
- [Fastify](/integrations/fastify) — the same in-process story with a fail-closed boundary.
- [Configuration](/guide/basic/configuration) — every `defineConfig` option.
