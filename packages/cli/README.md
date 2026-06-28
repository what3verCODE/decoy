# @decoy/cli

The `decoy` bin: boot a server from a config (`decoy start`), validate without booting
(`decoy check`), and drive a running instance from an interactive TUI.

**Role** · the command-line entrypoint that wraps `@decoy/server`.
**Exports** · `run`, `createTui`, `processCommand` (the bin is `decoy`).
**Depends on** · `@decoy/core`, `@decoy/config`, `@decoy/server`.
**Used by** · end users (the `decoy` bin), `examples/*`.

Quickstart → `/guide/start/getting-started` and `/integrations/standalone`. Generated API →
`/reference/api/`.
