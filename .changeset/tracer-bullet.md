---
"@decoy/core": minor
"@decoy/config": minor
"@decoy/server": minor
"@decoy/cli": minor
---

Tracer bullet: point a base URL at a Decoy instance and get a real response back.

- `@decoy/core` — the pure, zero-IO engine: `createEngine(definitions).match(request, selection)`, OpenAPI `{id}` path matching, the catch-all preset, variant→response with inferred `Content-Type`, array-order first-match precedence.
- `@decoy/config` — `defineConfig`, config loading (`.ts/.js/.mjs` via jiti, `.yaml/.json`), recursive `routesDir` + `collectionsFile` resolution, fail-fast panic when no source is found.
- `@decoy/server` — HTTP transport that serves matched variants and fails closed (`501` + `x-mock-miss`) on a miss, one structured log line per request.
- `@decoy/cli` — `decoy start` boots a server from a config (or the default `mocks/` source).
