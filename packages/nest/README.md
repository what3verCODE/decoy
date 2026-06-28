# @decoy/nest

Wire the in-process engine as a NestJS module: matched routes are served from mocks, unmatched
requests fall through to the host app's controllers. The control handle is exported under
`DECOY_CONTROL`.

**Role** · the NestJS embedding adapter (partial mocking).
**Exports** · `DecoyModule`, `fromService`, `createDecoyMiddleware`, `DECOY_CONTROL`.
**Depends on** · `@decoy/core`, `@decoy/config`; peer `@nestjs/common`.
**Used by** · `examples/nest`.

Setup → `/integrations/nest`. Generated API → `/reference/api/`.
