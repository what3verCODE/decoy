# decoy

> A fast, contract-first HTTP mock you point a base URL at.

Author mock **routes** grouped into switchable **collections**, point any base URL at it, and
develop/test against deterministic scenarios without waiting for a backend — fail-closed by default,
so a test can never silently reach the real API. First-class e2e for Playwright and Testplane, plus a
standalone server.

Published under the `@decoy/*` scope; the CLI bin is `decoy`.

## Status

Pre-implementation. This repository currently holds the monorepo infrastructure and workspace
skeleton; packages are being built out.

## Repository layout

```
apps/
  docs/         documentation site
examples/       per-surface showcases — the e2e tier (`test:e2e` only)
packages/
  core/         types · engine · JMESPath templating · std fns · Router interface  (pure, no IO)
  config/       defineConfig · valibot schema · loaders
  server/       HTTP server · /__decoy__ control · sessions · passthrough
  cli/          bin: start / check / --tui
  control/      control SDK · SessionRouter base
  playwright/   PlaywrightRouter + fixtures
  testplane/    TestplaneRouter + fixtures
  express/      middleware adapter
  nest/         module adapter
  fastify/      plugin adapter
  ui/           @decoy/ui — web control panel SPA, opt-in install (future)
```

## CLI

```bash
decoy start [--config <path>] [--port <port>] [--json] [--watch] [--tui]   # boot a server from a config (or default mocks/)
decoy check [--config <path>]                                              # validate config + mocks, exit non-zero on error
```

`decoy start` emits one structured log line per request —
`method path → route:preset:variant | MISS(reason) | PASSTHROUGH(target)` plus status, latency, and
the resolved session (`global` or the `x-mock-session` id). Misses log at `warn`. Output is pretty
text by default; `--json` emits one machine-readable JSON line per request (and per lifecycle
message) for CI.

`--watch` enables **dev-only hot reload**: Decoy watches the config file, `routesDir`, and
`collectionsFile`, and re-parses + re-validates atomically on change (an invalid edit is rejected
and the running definitions are kept). Sessions keep their selection **by name** across a reload; a
collection that vanished warns and falls back to `defaultCollection`. It is **off by default** —
never enable it in CI/e2e, where frozen definitions keep runs deterministic. With an array config
each instance watches its own source: editing one service's mocks re-loads only that instance, while
editing the shared config file re-validates and re-loads every instance. `--port` is single-instance
only (each service declares its own port).

`--tui` launches an **interactive TUI** (Claude-Code-style) that drives the in-process engine through
slash commands while streaming live request logs into the same view:

| command | effect |
| --- | --- |
| `/collection <name>` | switch the active collection (the whole scenario) |
| `/route <route>:<preset>:<variant>` | pin one route to a variant (an override) |
| `/reset` | drop all per-route overrides |
| `/collections`, `/routes` | list what is available (`*` marks the active collection) |
| `/status` | show the active collection and overrides |
| `/help`, `/quit` | help / exit |

It drives **one** in-process engine, so it is single-instance only (a multi-instance array config is
rejected — boot the group with plain `decoy start`) and conflicts with `--json` (non-interactive CI
output). `--watch` still works under the TUI, with reload warnings flowing into the same view.

### Multi-instance topology

One running instance impersonates **one** upstream. To mock a group of services with the
one tool, make the config an **array** — `decoy start` boots one instance per entry, each on its own
port with independent routes/collections/passthrough — and point each upstream's base URL at its
instance:

```ts
// decoy.config.ts
import { defineConfig } from '@decoy/config'

export default defineConfig([
  { name: 'users', port: 4001, routesDir: './mocks/users', defaultCollection: 'happy-path' },
  { name: 'orders', port: 4002, routesDir: './mocks/orders', passthrough: { url: 'https://orders.real' } },
])
```

A single-object config is unchanged (one instance). Two services sharing a port is a load-time
error (caught by `decoy check`); use distinct ports, or `0` for an ephemeral one. Host-based
multiplexing on one port is explicitly out of scope (v2).

`decoy check` runs the full aggregate validation (schema, `route:preset:variant` cross-reference,
`extends` resolution, duplicate/overlapping routes, JMESPath parse) and prints every issue with its
`file:line`. It exits non-zero on any **error** and zero otherwise (warnings are reported but do not
fail), so it can gate a CI merge:

```yaml
- run: pnpm decoy check
```

## Adapters (in-process)

The standalone server is the centerpiece, but the same pure engine can be **embedded in a
real app** for partial mocking: matched routes are served from mocks, everything else falls through to
the host app's own handlers. `@decoy/express` is the in-process alternative to running the server —
identical matching/templating semantics, **fallthrough instead of fail-closed**.

```ts
import express from 'express'
import { loadConfig } from '@decoy/config'
import { fromService } from '@decoy/express'

const app = express()
app.use(express.json()) // a body parser before decoy enables `body:` matching

const service = await loadConfig()           // resolves decoy.config.* + mocks/
const decoy = fromService(service)           // or createDecoyMiddleware({ definitions, defaultCollection })
app.use(decoy)                               // serve matched routes from mocks

app.get('/users/:id', realHandler)           // reached only when no mock matches (fallthrough)

// Drive scenarios in-process via the canonical JS control API:
decoy.control.useCollection('checkout-fails')
decoy.control.useRoute('users-by-id', 'default', 'boom')
decoy.control.reset()
```

Mount the middleware **before** the routes you want to mock. Because a miss calls `next()` (rather
than the server's `501 + x-mock-miss`), unmatched requests reach the rest of the app untouched.

`@decoy/nest` is the same capability as a **NestJS module** — `DecoyModule.forService(service)` (or
`forRoot({ definitions, defaultCollection })`) embeds the engine, auto-applies the middleware on all
routes, and exports the control API under the `DECOY_CONTROL` token. Nest's default platform parses
the body before middleware, so `body:` matching needs no extra wiring.

```ts
import { Module } from '@nestjs/common'
import { loadConfig } from '@decoy/config'
import { DECOY_CONTROL, DecoyModule } from '@decoy/nest'

const service = await loadConfig()

@Module({
  imports: [DecoyModule.forService(service)], // matched routes mocked, everything else hits your controllers
})
export class AppModule {}

// Inject the embedded control API anywhere to drive scenarios in-process:
//   constructor(@Inject(DECOY_CONTROL) private readonly control: Controller) {}
//   this.control.useCollection('checkout-fails')
```

`@decoy/fastify` is the same capability as a **Fastify plugin** — `fastify.register(fromService(service))`
(or `createDecoyPlugin({ definitions, defaultCollection })`) embeds the engine via a `preHandler` hook and
carries the control API on `.control`. A matched route is served from its mock; a miss **falls through**
to a real Fastify route if one owns the path, and otherwise **fails closed** (`501 + x-mock-miss`, via the
plugin's not-found handler). Fastify parses `application/json` out of the box, so `body:` matching needs no
extra wiring.

```ts
import Fastify from 'fastify'
import { loadConfig } from '@decoy/config'
import { fromService } from '@decoy/fastify'

const app = Fastify()
const service = await loadConfig()
const decoy = fromService(service)
await app.register(decoy)                     // serve matched routes; fall through / fail closed otherwise

app.get('/users/:id', realHandler)            // reached only when no mock matches (fallthrough)

decoy.control.useCollection('checkout-fails') // drive scenarios in-process
```

## Toolchain

- **proto** pins the toolchain (Node 24, pnpm 11) — run `proto install`.
- **pnpm workspaces** for the monorepo.
- **Biome** for lint + format, **TypeScript** for types, **Changesets** for releases.

```bash
proto install          # install pinned node + pnpm
pnpm install           # install workspace deps
pnpm check             # lint + format check (biome) + core purity guard
pnpm build             # build all packages
pnpm test              # run all package tests
```

### Core purity guard

`@decoy/core` is the keystone: a pure, zero-IO engine. A guard
(`tooling/core-purity`) enforces this — it scans `packages/core/src` and **fails if any source
imports a Node built-in** (`node:fs`, `http`, `crypto`, …), the IO surface a pure engine must never
reach. It runs as part of `pnpm check` (and therefore in CI); run it directly with:

```bash
pnpm --filter @decoy/core-purity run guard
```

## License

[MIT](./LICENSE)
