# @decoy/express

Mount the in-process engine as Express middleware: matched routes are served from mocks, unmatched
requests fall through to the host app's own handlers.

**Role** · the Express embedding adapter (partial mocking).
**Exports** · `fromService`, `createDecoyMiddleware`, `DecoyMiddleware` (with its in-process
`control`).
**Depends on** · `@decoy/core`, `@decoy/config`; peer `express`.
**Used by** · `examples/express`.

Setup → `/integrations/express`. Generated API → `/reference/api/`.
