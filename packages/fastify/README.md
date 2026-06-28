# @decoy/fastify

Register the in-process engine as a Fastify plugin: matched routes are served from mocks, unmatched
requests fall through to real routes, and a request nothing owns fails closed (`501 + x-mock-miss`).

**Role** · the Fastify embedding adapter (partial mocking).
**Exports** · `fromService`, `createDecoyPlugin`, `DecoyPlugin` (with its in-process `control`).
**Depends on** · `@decoy/core`, `@decoy/config`; peer `fastify`.
**Used by** · `examples/fastify`.

Setup → `/integrations/fastify`. Generated API → `/reference/api/`.
