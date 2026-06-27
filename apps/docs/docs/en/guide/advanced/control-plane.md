---
title: Control plane
description: Drive Decoy at runtime — the canonical JS control API, its /__decoy__ HTTP mirror, and the transport-agnostic Router.
---

# Control plane

The control plane is how you switch scenarios at runtime. There's one canonical API, an HTTP mirror
of it for cross-process control, and a single **Router** interface so test code never cares which
transport it's using.

## The canonical JS API

In-process, Decoy exposes a **Controller** — one `use*` verb set that every other surface wraps:

- **`useCollection(name)`** — switch the active collection.
- **`useRoute(route, preset, variant)`** — pin one route's preset slot to a variant.
- **`reset()`** — drop per-route overrides.

Switching is **atomic**: the next request sees the new state. Adapters call this directly in-process
(no HTTP hop) wherever they can.

## The HTTP control mirror

For cross-process control — a test driving a separately-running server — the same handler is mounted
over HTTP under the **`/__decoy__`** prefix. It mirrors the JS API one-to-one:

```sh
curl -s -XPOST localhost:3001/__decoy__/collection -d '{"name":"error-state"}'
curl -s -XPOST localhost:3001/__decoy__/route -d '{"route":"users-by-id","preset":"default","variant":"boom"}'
curl -s -XPOST localhost:3001/__decoy__/reset
curl -s        localhost:3001/__decoy__/selection      # read the current selection
curl -s -XPOST localhost:3001/__decoy__/sessions       # mint an isolated session
```

The distinctive `/__decoy__` default prefix won't shadow a real upstream route. You configure the
mount with the [`control`](/guide/basic/configuration) option — `true` (default, same port), `false`
(off), or `{ port, prefix }` to move it to a separate port or rename the prefix (the collision
escape hatch, rarely needed). One handler serves both this cross-process mount and the same-origin
`--ui` panel mount; they differ only in where they're mounted.

### A typed client

Rather than hand-roll `fetch` calls, use `createControlClient` — a typed wrapper over the HTTP API.
Its own `useCollection`/`useRoute`/`reset` drive the **global** session; each call resolves with the
resulting selection so a switch is confirmable, and an unknown collection/route/preset/variant fails
loud with the server's message:

```ts
import { createControlClient } from '@decoy/control'

const control = createControlClient({ baseUrl: 'http://localhost:3001' })
await control.useCollection('error-state')
const sel = await control.getSelection()
```

## The Router abstraction

A **Router** is one interface — `useCollection` / `useRoute` / `reset`, each returning the resulting
selection — backed by many transports, so test code is transport-agnostic:

- **`ControlClient`** — drives the global session over the HTTP control API.
- **`SessionRouter`** — a first-class [session](/guide/advanced/sessions-and-scenarios) handle: a
  Router plus `id`, `headers`, `stampOn(context)`, and `destroy()`. Mint one with
  `createControlClient(...).createSession()` (fresh), `.session(id)` (adopt), or the one-call
  `createSessionRouter(...)` sugar.
- **`PlaywrightRouter`** — drives the in-process engine via `page.route`, isolated per browser context.
- **`TestplaneRouter`** — the same interface over Testplane's `browser.mock`.

Same methods, different wires. Swap the transport and your scenario-switching code is unchanged — see
[Integrations](/integrations/) for each adapter.

## Next steps

- [Sessions & Scenarios](/guide/advanced/sessions-and-scenarios) — isolate parallel tests with sessions.
- [Configuration](/guide/basic/configuration) — the `control` option and prefix/port overrides.
- [Reference](/reference/) — the full control / HTTP API.
