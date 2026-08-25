# 0001. Rust runtime and route-case-behavior semantic model

Date: 2026-08-25

## Status

Accepted for prototype direction.

## Context

Decoy started as a TS/JS monorepo with core, config, server, control, and frontend/test-runner
adapters. The next direction is a more portable mock tool that can be used from non-JS ecosystems
without requiring users to install Node manually or rewrite the engine per language.

The existing implementation is useful prior art, but some current terms and internals are not the
semantic contract Decoy wants to freeze.

## Decision

Build the next serious runtime prototype in Rust, targeting a native CLI/server binary.

Use the semantic model:

```txt
collection -> route -> case -> behavior
```

Collections select explicit `route:case:behavior` addresses. Routes are one file each, have an
explicit `id`, and exactly one top-level `transport`. Route match describes where an interaction
happens. Case match describes which request/message shape matched. Behavior describes what Decoy
does and has a canonical `kind`.

The first implementation milestone is HTTP-only runtime semantics plus sessions/control. Plugins,
WebSocket, gRPC, SSE, recording, and flows remain roadmap, but the model must leave room for them.

## Consequences

- Current `Preset`/`Variant` vocabulary should migrate toward `Case`/`Behavior` before API freeze.
- Current TS implementation is evidence, not law.
- Golden tests should define behavior before major rewrites expand.
- Collections remain scenario composition, not behavior scripting.
- Rust implementation should prioritize clear semantics and UX over copying current internals.
