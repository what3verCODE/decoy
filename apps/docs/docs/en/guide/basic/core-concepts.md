---
title: Core Concepts
description: Decoy's model — Route, Preset, Variant, Collection — and the two axes that keep which-service separate from which-behavior.
---

# Core Concepts

Decoy answers an HTTP request from definitions you author. Those definitions have four levels —
**Route → Preset → Variant → Collection** — and they're arranged so that *which service* you're
mocking and *which behavior* it has right now stay independent. Understand these and the rest of
Decoy is configuration around them.

## The four levels

Think of a request flowing through them in order: a **Route** decides *is this my endpoint?*, a
**Preset** decides *does the request look the way this case expects?*, a **Variant** is the
*response to send*, and a **Collection** decides *which variant is active right now*.

### Route

A **Route** is a coarse request matcher and a namespace: an HTTP `method` plus a `path` (with
OpenAPI-style `{id}` parameters), under a stable `id`. It belongs to one upstream service via its
path.

```yaml
id: users-by-id
method: GET
path: /users/{id}
```

`GET /users/42` matches this route; `42` is captured as the `id` path parameter. The `id`
(`users-by-id`) is how collections and overrides address the route later.

### Preset

A **Preset** layers additional request-match conditions onto a route — a *case* for the request
shape. Each of `query` / `headers` / `body` is either an object pattern (subset-matched for
`query`/`headers`, deep-partial for `body`) or a `${ }` predicate gated on truthiness; fields are
ANDed together. The empty preset `{}` is a catch-all that matches any request to the route.

```yaml
presets:
  default: {}            # catch-all: matches any GET /users/{id}
```

Presets are matchers, so they're reusable: the same `default` case can select different
responses in different scenarios. (See [Matching & Templating](/guide/basic/) for the full
predicate and templating syntax.)

### Variant

A **Variant** is one response for a route: `status`, optional `headers`, optional `delay`, and a
`body`. A route names as many variants as it has distinct outcomes.

```yaml
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

Here `users-by-id` has two outcomes — a healthy user (`ada`) and an upstream failure (`boom`).
Which one a request gets is *not* decided here; that's the collection's job.

### Collection

A **Collection** is an ordered list of `route:preset:variant` activations — the unit you switch to
change the whole **scenario**. Switching collections swaps every route's behavior atomically.

```yaml
- id: happy-path
  routes:
    - users-by-id:default:ada
- id: error-state
  routes:
    - users-by-id:default:boom
```

`happy-path` serves the `ada` variant for the `default` case of `users-by-id`; `error-state`
serves `boom` instead. Flip the active collection and the same `GET /users/42` returns a
different response — the property that makes a whole scenario switchable in one move.

## Variant address

The triple **`route:preset:variant`** — e.g. `users-by-id:default:ada` — is a **variant address**.
It's the vocabulary collections use to activate responses, and the vocabulary you use to override a
single route at runtime.

## The two axes

The four-level model exists to keep two orthogonal questions from collapsing into one:

- **Service axis — _which upstream?_** Encoded in a route's `path` (and host). One Decoy instance
  impersonates one service. This axis is fixed by how you author routes.
- **Scenario axis — _which behavior now?_** Encoded in the **active collection**. This axis is
  switched at runtime.

Collapsing them — naming scenarios like `users-success-orders-error` — explodes combinatorially as
services and behaviors multiply. Keeping them separate means behaviors compose: any collection can
mix any service's variants without a name blow-up.

Two switch operations fall out of the split:

- **Swap the collection** — change the whole scenario at once.
- **Override one route** — pin a single `route:preset:variant` on top of the active collection,
  then `reset` back to the collection's baseline.

Both are driven at runtime through the [control plane](/guide/advanced/), per
[session](/guide/advanced/).

## Invariants worth knowing

- **Fail-closed.** A request that matches no variant returns `501` with an `x-mock-miss` header — it
  never silently reaches the real API (unless you explicitly opt into global passthrough). A
  misconfigured test fails loudly.
- **Deterministic, first match wins.** Matching precedence is plain array order — the first
  activation that matches wins. There's no specificity ranking to reason about, so the same request
  always resolves the same way.
- **The only mutable state is the selection** — the active collection plus per-route overrides, held
  per session. Matching itself is a pure function of request and selection.

## Next steps

- [Configuration](/guide/basic/) — wire routes, collections, and the fail-closed default into a project.
- [Matching & Templating](/guide/basic/) — the full preset predicate and `${ }` templating syntax.
- [Sessions & Scenarios](/guide/advanced/) — isolate parallel tests and drive scenario switching.
