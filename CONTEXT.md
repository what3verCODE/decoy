# Decoy

The normative dictionary for Decoy. When a term below is used in code, docs, or discussion, it
means *exactly* this — one line per term, plus the synonyms to avoid. The prose explanation of how
the terms fit together lives in the docs site (**Guide → Core Concepts**,
`apps/docs/docs/en/guide/basic/core-concepts.md`); this file is the dictionary that page points
back to. Name = `decoy`; packages publish scoped as `@decoy/*`, CLI bin `decoy`.

## Language

### Core concepts

**Route**:
A coarse request matcher and namespace — an HTTP `method` + `path` (OpenAPI `{id}` params) under a
stable `id` like `users-by-id`. Belongs to one upstream service via its path/host.
_Avoid_: "endpoint" (ambiguous with the upstream's own routes), "handler" (a Route serves no code).

**Preset**:
Additional request-match conditions layered on a **Route** — `query`/`headers`/`body` object
patterns or `${ }` predicates, ANDed; `{}` is a catch-all. A reusable *case* for the request shape.
_Avoid_: "case"/"when" (provisional alternates, not the term), "matcher" (the **Route** matches too).

**Variant**:
One response for a **Route** — `status` · `headers` · `delay` · `body`, every field `${ }`-templated.
A Route names one Variant per distinct outcome.
_Avoid_: "response" (a Variant is an addressable named outcome, not the raw response), "mock".

**Collection**:
An ordered list of `route:preset:variant` activations — the unit you switch to change the whole
**Scenario** atomically. Supports `extends` (inherit + override).
_Avoid_: "scenario" (that's the behavior, this is the artifact encoding it), "set", "group".

**Scenario**:
Informal — the behavior a **Collection** encodes (`happy-path`, `checkout-fails`, `empty-state`).
_Avoid_: using interchangeably with **Collection** (the Collection is the thing; the Scenario is what it means).

**Variant address**:
The `route:preset:variant` triple, e.g. `users-by-id:default:ada` — how Collections and overrides
name a **Variant**.
_Avoid_: "path" (collides with a Route's HTTP path), "key".

### The two axes

**Service axis**:
*Which upstream?* Encoded in a **Route**'s `path`/host. One Decoy instance impersonates one service.
_Avoid_: conflating with the **Scenario axis** — naming Collections like `users-ok-orders-error`.

**Scenario axis**:
*Which behavior now?* Encoded in the active **Collection**, switched at runtime.
_Avoid_: encoding behavior in **Route** ids (that fixes it to the Service axis).

### Selection & sessions

**Selection**:
The *only* mutable state — the active **Collection** (by name) + per-route overrides. Held per **Session**.
_Avoid_: "state" (too broad — matching itself is stateless), "config" (the Selection is runtime, not authored).

**Session**:
An isolated **Selection** scope keyed by the `x-mock-session` header. "Global" is the default
(dev); created Sessions isolate parallel e2e tests on a shared server. A tests-only concept.
_Avoid_: "tenant", "context", "user" (it scopes a Selection, nothing else).

### Matching & templating

**Request envelope**:
The fixed shape every preset predicate and `${ }` template evaluates against —
`{ method, url, path, pathParams, query, headers, cookies, body }`. A missing path is `null`.
_Avoid_: "context", "request object" (it is this exact shape, not an arbitrary bag).

**Standard function**:
A built-in JMESPath function (v1: `uuid()`) registered so `${ }` expressions can fabricate data the
query language can't. Part of the cross-language contract; custom functions register through the same seam.
_Avoid_: "helper", "builtin" alone (it is a named, contract-versioned function).

### Invariants

**Fail-closed**:
A miss returns `501` + `x-mock-miss` + a diagnostic body; it never reaches the real API unless
**Passthrough** is explicitly on.
_Avoid_: "strict mode" (it is the default, not a mode you turn on).

**Passthrough**:
The explicit opt-in that lets an unmatched request reach the real upstream instead of failing closed.
_Avoid_: "proxy" (Passthrough is the opt-in escape hatch, not Decoy's normal operation).

### Control surfaces

**Controller**:
The canonical JS control API — `useCollection`, `useRoute`, `reset`. One `use*` verb set; every
other control surface wraps it.
_Avoid_: "admin" (retired as a concept), "manager".

**Control API**:
The HTTP mirror of the **Controller** for cross-process control, mounted under `/__decoy__`
(configurable). One handler, two mounts: the cross-process mount on the mock port (Sessions live
here) and the same-origin `--ui` panel mount.
_Avoid_: "admin API" (the admin concept was retired), "/\_\_admin\_\_".

**Router**:
A first-class **Session** handle — `useCollection`/`useRoute`/`reset` plus `id`/`headers`/`stampOn`/
`destroy`. `createControlClient(...).createSession()` returns one over HTTP; `PlaywrightRouter`
drives the in-process engine. Same methods, different transports.
_Avoid_: "client" (the client creates Routers; a Router is the per-Session handle).
