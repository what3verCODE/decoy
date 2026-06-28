---
title: Configuration reference
description: Every defineConfig option and mock-file field — types, defaults, and constraints for the Decoy config, routes, presets, variants, and collections.
---

# Configuration reference

The exhaustive schema. For a task-first walkthrough see the
[Configuration guide](/guide/basic/configuration); this page lists every field. The generated
[`@decoy/config` API](/reference/api/) carries the same types as TypeScript.

## Config shape

A config is a single **service** object or an **array** of them. An array boots one instance per
entry — each on its own port with independent routes, collections, and passthrough — and
`decoy start` runs them all.

```ts
import { defineConfig } from '@decoy/config'

export default defineConfig({ name: 'users', port: 3001, routesDir: './mocks/routes' })
// — or —
export default defineConfig([
  { name: 'users', port: 3001, routesDir: './users/routes' },
  { name: 'orders', port: 3002, routesDir: './orders/routes' },
])
```

A config may be authored as `decoy.config.{ts,js,mjs,yaml,json}`. `.ts`/`.js` configs export
`defineConfig(...)` for typed editor support; `.yaml`/`.json` are static. Mock files always stay
declarative.

## Service options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `name` | `string` | `'decoy'` | Display name in request logs. |
| `port` | `number` | `4000` | Port the server listens on. A server concern — omittable for in-process router surfaces (e.g. `@decoy/playwright`), which boot no server. |
| `control` | `boolean \| { port?, prefix? }` | `true` | HTTP control API exposure — see [below](#control). |
| `missStatus` | `number` (100–599, integer) | `501` | HTTP status returned for a fail-closed miss. |
| `passthrough` | `{ url: string }` | off | Global passthrough target — see [below](#passthrough). |
| `sessionIdleTtl` | `number` (ms, ≥ 1, integer) | `1800000` (30 min) | Idle TTL after which an abandoned [session](/guide/advanced/sessions-and-scenarios) is reaped. Tests-only. |
| `routesDir` | `string` | — | Directory of route files, scanned **recursively**; relative to the config file. |
| `collectionsFile` | `string` | — | Single file holding the ordered collections; relative to the config file. |
| `defaultCollection` | `string` | first collection | The collection a fresh server boots into. |
| `requestLog` | `RequestLogConfig` | memory store | Durable request-log store — see [below](#requestlog). |
| `routes` | `Route[]` | — | Inline route definitions, merged with `routesDir`. |
| `collections` | `Collection[]` | — | Inline collections, merged with `collectionsFile`. |

### `control` {#control}

HTTP control API exposure. `true` (default) mounts it on the same port under the `/__decoy__`
prefix; `false` disables it. The object form configures the mount — the escape hatch for when a real
`/__decoy__/*` upstream would otherwise be shadowed:

| Field | Type | Description |
| --- | --- | --- |
| `port` | `number` | Move the control mount to a separate port. |
| `prefix` | `string` | Rename the mount prefix (default `/__decoy__`). |

### `passthrough` {#passthrough}

When set, **unmatched** requests are forwarded verbatim to this single upstream
(`{url}{path}{query}`, method/headers/body forwarded, response returned as-is) instead of failing
closed. Off by default — a test can never silently reach a real API. Global per instance; no
per-route or per-variant targets.

| Field | Type | Constraint | Description |
| --- | --- | --- | --- |
| `url` | `string` | non-empty, valid URL | Upstream base URL for unmatched requests. |

### `requestLog` {#requestlog}

Backs the request-log ring (the `GET /__decoy__/logs` stream).

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `store` | `'memory' \| 'sqlite'` | `'memory'` | Process-bound in-memory store, or a `node:sqlite` file shared across this config's instances. |
| `path` | `string` | `.decoy/…` | Filename template for the sqlite store, resolved **once at boot**. Sqlite-only. |
| `retention.maxRows` | `number` (≥ 1, integer) | — | Ring-evict the oldest records past this count. Applies to both stores. |
| `cleanup` | `'on-exit' \| 'on-session-end' \| 'never'` | `'never'` | When to delete the sqlite file/rows. Sqlite-only (no-op for memory). |

`path` template tokens (resolved once at boot; an unknown token fails `decoy check`):

- **UTC strftime:** `%Y %m %d %H %M %S %s`
- **Named:** `{name} {pid} {port}`

`cleanup` modes: `on-exit` removes the file on shutdown; `on-session-end` drops a session's rows on
destroy (which disables post-session log retrieval); `never` keeps the file.

## Mock file schema

### Route

A route is the coarse matcher and namespace. Authored in `routesDir` files (or inline `routes`).

| Field | Type | Constraint | Description |
| --- | --- | --- | --- |
| `id` | `string` | non-empty | Stable identifier used by collections and `useRoute`. |
| `method` | `string` | one of `GET POST PUT PATCH DELETE HEAD OPTIONS` | HTTP method; matched case-insensitively. |
| `path` | `string` | starts with `/` | Path pattern; supports `{param}` segments. |
| `presets` | `Record<string, Preset>` | — | Named request-match conditions. |
| `variants` | `Record<string, Variant>` | — | Named responses. |

### Preset

Additional request-match conditions layered on a route. Each field is a `${ }` predicate **string**
or a literal **pattern** object; fields are ANDed. `{}` is the catch-all.

| Field | Type | Description |
| --- | --- | --- |
| `pathParams` | `string \| Record<string, string>` | Match on `{param}` path values. |
| `query` | `string \| Record<string, string>` | Match on query parameters. |
| `headers` | `string \| Record<string, string>` | Match on request headers. |
| `body` | `unknown` | Match on the request body (any value). |

### Variant

One response. All fields optional; `body` is opaque. `status` and `delay` accept a string so they
can carry a `${ }` template, coerced to a number when the response is built.

| Field | Type | Description |
| --- | --- | --- |
| `status` | `number` (integer) `\| string` | HTTP status code. |
| `headers` | `Record<string, string>` | Response headers. |
| `delay` | `number` (≥ 0) `\| string` | Artificial delay in ms before responding. |
| `body` | `unknown` | Response body. |

### Collection

An ordered list of `route:preset:variant` activations bundled into one switchable scenario.

| Field | Type | Constraint | Description |
| --- | --- | --- | --- |
| `id` | `string` | non-empty | Scenario identifier used by `useCollection` and `defaultCollection`. |
| `extends` | `string` | — | Inherit another collection's entries, then override. |
| `routes` | `string[]` | — | Ordered `route:preset:variant` activation strings. |

## Validate

`decoy check` validates the config and all mock files without booting a server, exiting non-zero on
any error — wire it into CI. Config errors are located by service identifier (`service "name"` /
`service [index]`); mock-file errors carry `file:line`.

## Next steps

- [Control / HTTP API](/reference/control-api) — the runtime control surface.
- [API](/reference/api/) — the generated TypeScript reference (`ServiceConfig`, `LoadedService`, …).
- [Matching & Templating](/guide/basic/matching-and-templating) — how presets and `${ }` templates resolve.
