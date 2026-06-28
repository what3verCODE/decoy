---
title: Control / HTTP API
description: The runtime control surface — the in-process Controller, the transport-agnostic Router, the typed clients, and every /__decoy__ HTTP endpoint.
---

# Control / HTTP API

How you switch scenarios at runtime. There is one canonical set of verbs —
`useCollection` / `useRoute` / `reset` — exposed in process as a **Controller**, mirrored over HTTP
under `/__decoy__`, and wrapped by typed clients and a transport-agnostic **Router**. For the
concepts behind this surface see the [Control plane guide](/guide/advanced/control-plane).

## The verbs

| Verb | Effect |
| --- | --- |
| `useCollection(name)` | Switch the active collection. |
| `useRoute(route, preset, variant)` | Pin one route's `preset` slot to a `variant`, on top of the active collection. |
| `reset()` | Drop all per-route overrides, back to the collection baseline. |

Every switch is **atomic**: the next request sees the new state.

## In process — Controller

The canonical synchronous API (`@decoy/core`), exposed by every embedded adapter as `control`:

```ts
control.useCollection('error-state')
control.useRoute('users-by-id', 'default', 'boom')
control.reset()
control.selection   // the current { collection, overrides } selection
```

Embedded adapters surface it directly — see [Express](/integrations/express),
[Fastify](/integrations/fastify), and [Nest](/integrations/nest).

## Across processes — Router and clients

A **Router** (`@decoy/control`) is the same verbs as `async` methods, each resolving with the
resulting [`Selection`](/reference/api/) so a switch is confirmable. Backed by several transports:

- **`createControlClient({ baseUrl })`** → a `ControlClient` driving the **global** session over the
  HTTP API. Adds `getSelection()`, plus `createSession()` (fresh) and `session(id)` (adopt).
- **`createSessionRouter({ baseUrl })`** → a `SessionRouter`: a Router bound to an isolated server
  [session](/guide/advanced/sessions-and-scenarios), plus `id`, `headers`, `stampOn(context)`, and
  `destroy()`.
- **`PlaywrightRouter`** (`@decoy/playwright`) → drives the in-process engine over `page.route`.

```ts
import { createControlClient, createSessionRouter } from '@decoy/control'

const control = createControlClient({ baseUrl: 'http://localhost:3001' })
await control.useCollection('error-state')

const session = await createSessionRouter({ baseUrl: 'http://localhost:3001' })
await session.stampOn(context)   // app requests now carry x-mock-session
await session.useCollection('error-state')   // only this session moves
await session.destroy()
```

An unknown collection/route/preset/variant rejects with the server's message.

## HTTP API

The cross-process mirror, mounted under the control `prefix` (default `/__decoy__`). All bodies and
responses are JSON.

| Method · path | Body | Returns |
| --- | --- | --- |
| `GET {prefix}` · `GET {prefix}/selection` | — | The current selection. |
| `POST {prefix}/collection` | `{ name }` | `useCollection` → resulting selection. |
| `POST {prefix}/route` | `{ route, preset, variant }` | `useRoute` → resulting selection. |
| `POST {prefix}/reset` | — | `reset` → resulting selection. |
| `POST {prefix}/try` | `{ method?, url? \| path?, query?, headers?, body? }` | Dry-run match: `{ resolution, response }`, zero side effects. |
| `GET {prefix}/routes` | — | Routes catalog (id, method, path, preset/variant counts). |
| `GET {prefix}/routes/{id}` | — | A route's presets and variants in full. |
| `GET {prefix}/collections` | — | Collections catalog, the active one marked. |
| `GET {prefix}/collections/{name}` | — | A collection's resolved (post-`extends`) entries. |
| `GET {prefix}/logs` | — | SSE live request stream (see below). |
| `GET {prefix}/sessions` | — | List sessions (global + created) with their selection. |
| `POST {prefix}/sessions` | — | Create a session → `201 { id }`. |
| `GET {prefix}/sessions/{id}/logs` | — | A session's request timeline, ordered across services (survives destroy). |
| `DELETE {prefix}/sessions/{id}` | — | Destroy a session. |

```sh
curl -s -XPOST localhost:3001/__decoy__/collection -d '{"name":"error-state"}'
curl -s        localhost:3001/__decoy__/selection
curl -s -XPOST localhost:3001/__decoy__/sessions      # → {"id":"…"}
```

### Status codes

- **`200`** — a successful read or a mutation (mutations echo the resulting selection).
- **`201`** — a session was created.
- **`400`** — malformed body, or an unknown collection/route/preset/variant.
- **`404`** — unknown endpoint, route, collection, or session.

### Session scoping

Control endpoints are scoped by the `x-mock-session` header. With no header they target the global
(dev) session; with one they target — and lazily create — that session, isolating parallel tests on
a shared server. A `SessionRouter` sets this header for you.

### Live request stream

`GET {prefix}/logs` is a Server-Sent Events stream: it replays the retained history on connect, then
tails every newly appended record one-way. Each frame's SSE `id:` carries the record `seq` so a
client can dedupe re-delivered history after a reconnect. The store backing it is configured by
[`requestLog`](/reference/configuration#requestlog).

## Next steps

- [Configuration reference](/reference/configuration) — the `control` mount and `requestLog` options.
- [API](/reference/api/) — the generated `@decoy/control` and `@decoy/core` types.
- [Sessions & Scenarios](/guide/advanced/sessions-and-scenarios) — isolating parallel tests.
