---
title: Matching & Templating
description: How Decoy matches a request to a variant — path syntax, subset matching, JMESPath predicates, first-match-wins precedence — and how ${ } templating builds the response.
---

# Matching & Templating

Two questions decide what Decoy returns: *which variant does this request match?* and *what does that
variant's response look like?* Matching answers the first; `${ }` templating answers the second.

## Matching a request

### Path syntax

A [route](/guide/basic/core-concepts) owns the `method` and `path`. Paths use **OpenAPI `{param}`
syntax** — `path: /users/{id}` matches `GET /users/42` and captures `id = "42"`. (A `regex:` escape
hatch is reserved for later.)

### Subset matching

A [preset](/guide/basic/core-concepts) layers extra conditions via `pathParams`, `query`, `headers`,
and `body`. Matching is **subset / partial**: the request must *contain* the pairs you specify, and
any extras are ignored — so tracking params and incidental headers never break a match. `body` is
matched **deep-partial** (nested objects need only the keys you name). Values compare by literal
equality.

```yaml
presets:
  default: {}                 # catch-all — matches any request to the route
  ada:
    pathParams: { id: "42" }  # matches GET /users/42 (the {id} segment)
  admin:
    query: { role: admin }    # matches ?role=admin&anything=else; ignores the extras
  with-token:
    headers: { authorization: Bearer t0ken }
```

Specifying only what you care about is the default; `exact: true` is reserved for when you need it.

### JMESPath predicates

When literal patterns aren't enough, a `pathParams`/`query`/`headers`/`body` field can be a **string**
instead of an object — a `${ }` predicate evaluated against the request and gated on truthiness.
String predicates are **ANDed** with any object patterns:

```yaml
presets:
  has-items:
    body: "${ length(items) > `0` }"   # matches when the request body has at least one item
```

This avoids duplicating a route five times for a complex condition — JMESPath expresses it in one
line.

### Precedence: array order, first match wins

A collection can activate several presets of the *same* route, so a request could match more than
one. Decoy resolves this with **explicit array order**: the collection's `routes: [...]` list *is*
the precedence. Decoy matches the route by method + path, then walks that route's active presets **in
list order** and returns the **first** whose conditions pass.

```yaml
- id: mixed
  routes:
    - users-by-id:admin:admin-view     # specific — checked first
    - users-by-id:default:ada          # {} catch-all — listed last
```

Two rules follow: order **specific → general**, and put a `{}` catch-all **last**. The same rule
resolves overlapping routes — list `/users/me` before `/users/{id}`. There's no specificity scoring
to reason about, so resolution is always "whatever's higher in the list."

## Building the response with `${ }`

Every string value of a [variant](/guide/basic/core-concepts) — anywhere in `status`, `headers`,
`delay`, or `body`, however deeply nested (keys are not templated) — can carry a `${ <jmespath> }`
expression, evaluated against the **request envelope**:

```
{ method, url, path, pathParams, query, headers, cookies, body }
```

```yaml
variants:
  echo:
    status: 200
    body:
      requestedId: "${ pathParams.id }"
      greeting: "Hello ${ query.name }"
```

### Typing and lenience

- A value that is **entirely** `"${ expr }"` yields the raw evaluated value with its type preserved
  (a number stays a number, an object stays an object).
- An **embedded** expression (`"Hello ${ ... }"`) interpolates as a string.
- A **missing path renders as `null`** — templating is lenient, not fatal.
- `status` and `delay` accept a string so they too can be templated, coerced to a number when the
  response is built.
- Write `\${` for a literal `${`. The scan is brace-balanced, so an expression containing `}` (a
  multiselect-hash, or `map` + `range`) is captured whole.

A variant string with no `${ }` is served verbatim — the no-template fast path.

### Standard and custom functions

JMESPath can query the request but can't *fabricate* data, so Decoy registers a **standard function
library** into the runtime. v1 ships **`uuid()`** (an RFC 4122 v4 string); further functions
(`now`, `randomInt`, `range`, `pick`, …) roll out incrementally through the same registration seam.
Generation combines `map` + `range`:

```yaml
variants:
  many-users:
    body: "${ map(&{id: @, name: join('', ['user-', to_string(@)])}, range(`1`, `100`)) }"
```

Per-project **custom functions** register through `defineConfig`'s `jmespath.functions` — code lives
in the config entry, while mock files stay declarative. The standard set is part of Decoy's
cross-language contract, so a per-language client reproduces each function by name and semantics.

## Next steps

- [Configuration](/guide/basic/configuration) — wire routes, collections, and passthrough into a project.
- [Core Concepts](/guide/basic/core-concepts) — the Route → Preset → Variant → Collection model.
- [Sessions & Scenarios](/guide/advanced/sessions-and-scenarios) — switch scenarios and isolate parallel tests at runtime.
