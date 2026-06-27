---
title: Nest
description: Wire @decoy/nest as an in-process module — serve mocks, fall through to your real controllers on a miss, and switch scenarios via the DECOY_CONTROL token.
---

# Nest

Wire `@decoy/nest` as a module into a real NestJS app. A request that matches a mocked route is
served from its variant; a miss **falls through** to your app's own controllers. The mock runs *in
process*, so "start the client and the mock" collapses to starting one app — there is no standalone
server and no `/__decoy__`. Scenarios are switched through the module's exported `control` handle,
resolved from the Nest container under the `DECOY_CONTROL` token.

## Install

```sh
npm install @decoy/nest @decoy/config reflect-metadata
```

You author the same `decoy.config.ts` + `mocks/` as everywhere else (see
[Getting Started](/guide/start/getting-started)); here `port` is only the port your own app listens
on.

## Wire the module

Import `DecoyModule.forService(service)` into your app module. `reflect-metadata` must load before any
Nest decorator runs. Resolve the embedded control handle from the live container with `strict: false`
so Nest searches the imported module's exports for the token:

```ts
import 'reflect-metadata'
import { loadConfig } from '@decoy/config'
import type { Controller as ControlApi } from '@decoy/core'
import { DECOY_CONTROL, DecoyModule } from '@decoy/nest'
import { Controller, Get, Module } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'

// A real host controller — reached only when Decoy misses and falls through.
@Controller()
class HostController {
  @Get('health')
  health() {
    return { status: 'ok', from: 'host app' }
  }
}

const service = await loadConfig({ configPath: './decoy.config.ts' })

@Module({
  imports: [DecoyModule.forService(service)],
  controllers: [HostController],
})
class AppModule {}

const app = await NestFactory.create(AppModule)
const control = app.get<ControlApi>(DECOY_CONTROL, { strict: false })
await app.listen(service.port)
```

```sh
curl -s localhost:3003/users/42   # mocked variant (happy-path)
# {"id":42,"name":"Ada"}
curl -s localhost:3003/health     # real host controller (fall-through)
# {"status":"ok","from":"host app"}
```

## Switch scenarios in-process

There's no `/__decoy__` here — the resolved `control` is the in-process
[Controller](/guide/advanced/control-plane). A host provider, a feature test, or any in-process code
calls it; the next request sees the switch:

```ts
control.useCollection('error-state')
// → GET /users/42 now serves the 500 variant
control.useCollection('happy-path')   // back to baseline
```

## Misses fall through — no fail-closed 501

In-process the module never fails closed with a `501` (that's the standalone server's job). A route
that is neither mocked nor handled falls through to the host app's default `404`:

```sh
curl -si localhost:3003/orders
# HTTP/1.1 404 Not Found
```

Nothing reaches a real API, because there isn't one. If you need a hard `501 + x-mock-miss`
boundary, use the [standalone server](/integrations/standalone).

## A note on bundling

Nest's decorators and `nest start` expect a build step. The example bundles `@decoy/*` TS sources and
the Nest decorators with **Rspack** into a runnable output, then runs it on plain Node — see
[`examples/nest`](https://github.com/what3verCODE/decoy/tree/main/examples/nest). In your own app,
your existing Nest build (the Nest CLI, or your bundler) already covers this.

## Next steps

- [Control plane](/guide/advanced/control-plane) — the in-process `control` verbs.
- [Express](/integrations/express) — the same in-process middleware story, with less ceremony.
- [Configuration](/guide/basic/configuration) — every `defineConfig` option.
