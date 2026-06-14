---
"@decoy/core": minor
"@decoy/server": minor
---

Collections `extends` and the canonical JS control API.

- `@decoy/core` — `createEngine` resolves a collection's `extends` chain into a flat, ordered entry list (inherit, then override by `route:preset` slot in place; new slots append). Cyclic or undefined-parent chains throw at creation. Selection gains per-route `overrides`, applied at match time. New `createController(definitions, defaultCollection)` exposes the canonical `setCollection` / `useRoute` / `reset` over the only mutable state (the selection), validating every call against the definitions; switching is atomic and the engine stays pure.
- `@decoy/server` — the HTTP server is driven by a `Controller` and exposes it as `server.control`, so a test or tool can switch collections and override routes in-process; the next request reflects the change atomically.
