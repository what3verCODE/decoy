---
"@decoy/core": minor
"@decoy/server": patch
"@decoy/express": patch
"@decoy/fastify": patch
"@decoy/nest": patch
"@decoy/playwright": patch
---

Concentrate response serialization into one transport-neutral `@decoy/core` module.

The matched-response and fail-closed-miss serialization rules — infer `content-type: application/json` unless set, `JSON.stringify` the body, apply status + headers, and the miss-body `{ error }` shape — were reimplemented across all five transports. They now live once at the core seam: `@decoy/core` exports `planResponse`, `planMatched`, `planMiss`, and the `ResponsePlan` type. A plan carries the status, the finalized headers, and the body **bytes** (a string, or `undefined` for no payload); each adapter only writes the plan its own way (`server`/`express`/`nest` to a Node `res`, `fastify` via `reply.send`, `playwright` returns fulfill options). Output bytes are identical across transports and pinned by a shared core test. No behavior changes.
