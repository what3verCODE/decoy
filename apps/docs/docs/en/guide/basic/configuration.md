---
title: Configuration
description: Structure a Decoy mock project with defineConfig — routesDir, collectionsFile, the fail-closed default, and opt-in passthrough.
---

# Configuration

A Decoy project is three things: a **config** that wires everything together, a **routesDir** of
[route](/guide/basic/core-concepts) definitions, and a **collectionsFile** of switchable scenarios.
This page covers the config.

## `defineConfig`

Author the config in `decoy.config.{ts,js,mjs,yaml,json}`. A `.ts`/`.js` config exports
`defineConfig(...)` for typed editor support; `.yaml`/`.json` configs are static. Mock route and
collection files always stay declarative — the config entry is the one place code is allowed.

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

| Option | Default | What it does |
| --- | --- | --- |
| `name` | `'decoy'` | Display name in request logs. |
| `port` | `4000` | Port the server listens on. One instance impersonates one upstream. |
| `routesDir` | — | Directory of route files, scanned **recursively**. |
| `collectionsFile` | — | Single file holding the ordered collections. |
| `defaultCollection` | first collection | The collection a fresh server boots into. |
| `missStatus` | `501` | HTTP status returned for a fail-closed miss. |
| `passthrough` | off | Opt-in upstream for unmatched requests (see below). |
| `control` | on, `/__decoy__` | The HTTP [control plane](/guide/advanced/control-plane) exposure. |

`routesDir`/`collectionsFile` resolve relative to the config file. You can also supply `routes` and
`collections` inline on the config object instead of (or merged with) the file paths. The full
option list lives in the [Reference](/reference/).

### One service or many

`defineConfig` accepts a single service **object**, or an **array** of services. An array boots one
instance per entry — each on its own port with independent routes, collections, and passthrough —
and `decoy start` runs them all. Point each upstream's base URL at its instance:

```ts
export default defineConfig([
  { name: 'users', port: 3001, routesDir: './users/routes', collectionsFile: './users/collections.yaml' },
  { name: 'orders', port: 3002, routesDir: './orders/routes', collectionsFile: './orders/collections.yaml' },
])
```

This is how you mock a group of services with one tool: one instance per upstream keeps the
**service axis** clean (see [Core Concepts](/guide/basic/core-concepts)).

## The fail-closed default

A request that matches no variant — no route, or a route whose active presets all miss — does **not**
reach a real backend. It returns `missStatus` (`501` by default) with an `x-mock-miss: true` header
and a diagnostic body that distinguishes *no route matched* from *route matched but no preset matched*.

```sh
curl -si localhost:3001/orders
# HTTP/1.1 501 ...
# x-mock-miss: true
```

This is the property a test suite needs most: a misconfigured request fails loudly instead of
silently passing by hitting production. A test can hard-assert on `x-mock-miss`.

## Opt-in passthrough

The escape hatch for a "develop against mocks, then point at the real backend" workflow is
**passthrough**. Set a single upstream URL and unmatched requests are forwarded to it verbatim
(`{url}{path}{query}`, method/headers/body intact) instead of failing closed:

```ts
export default defineConfig({
  name: 'users',
  port: 3001,
  routesDir: './mocks/routes',
  collectionsFile: './mocks/collections.yaml',
  passthrough: { url: 'https://users.example.com' },
})
```

Passthrough is **off by default**, **global** (one target per instance, not per route), and the
typical split is *dev = on, CI/e2e = off* — frozen, fail-closed definitions keep test runs
deterministic. To mock some services and pass others through, run one instance per upstream and
enable passthrough only where you want it.

## Validate before running

`decoy check` validates the config and mocks without booting a server, exiting non-zero on any
error — wire it into CI:

```sh
npx decoy check
```

## Next steps

- [Matching & Templating](/guide/basic/matching-and-templating) — how requests match and responses are built.
- [Sessions & Scenarios](/guide/advanced/sessions-and-scenarios) — isolate parallel tests and switch scenarios at runtime.
- [Reference](/reference/) — the complete configuration schema.
