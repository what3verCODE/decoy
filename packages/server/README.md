# @decoy/server

The HTTP transport: boot the pure engine on a port, serve matched variants, and fail closed on a
miss. Hosts the `/__decoy__` control mount, sessions, and passthrough.

**Role** · the standalone-server transport over `@decoy/core`'s engine.
**Exports** · `createServer`, `DecoyServer`, `createUiServer`, `Logger`, `version`.
**Depends on** · `@decoy/core`, `@decoy/config`.
**Used by** · `@decoy/cli`, `examples/*`.

Behaviour → `/reference/control-api` and `/integrations/standalone`. Generated API → `/reference/api/`.
