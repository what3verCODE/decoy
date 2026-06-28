# @decoy/control

The cross-process control SDK: a typed client over the `/__decoy__` HTTP API, plus the
transport-agnostic `Router`/`SessionRouter` that isolates parallel e2e on one shared server.

**Role** · the runtime control surface for tests and the panel — the async mirror of the engine's
in-process Controller.
**Exports** · `createControlClient`, `createSessionRouter`, `Router`, `SessionRouter`,
`SESSION_HEADER`.
**Depends on** · `@decoy/core`.
**Used by** · e2e suites (`examples/playwright-server`), the control panel.

Concepts → `/guide/advanced/control-plane`. Generated API → `/reference/api/`.
