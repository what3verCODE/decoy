# Decoy next direction

Status: working design note, not user documentation.

The old `apps/docs` documentation site has been removed while the product model is being reset. New
user docs should be recreated from this design note, `CONTEXT.md`, and ADRs once the native runtime
prototype has a stable shape.

## Product shape

Decoy is a general-purpose local mock tool. JS/TS remains important because the current ecosystem is
frontend-heavy, but the product center is a portable runtime, simple CLI, and stable semantics that
adapters can share.

## Runtime direction

The next serious implementation direction is a Rust native runtime/binary. The current TS
implementation is evidence, not law: preserve intentionally chosen semantics, not accidental current
behavior.

First milestone priority is HTTP runtime. Plugin and WebSocket design must be kept in mind, but not
implemented before the runtime is useful.

## Semantic model

Canonical vocabulary:

```txt
collection -> route -> case -> behavior
```

- Collection: ordered list of `route:case:behavior` activations, with `from` inheritance.
- Route: one file, explicit `id`, exactly one top-level `transport`.
- Route match: where/address, e.g. HTTP `method` + `/users/{id}`.
- Case: named input matcher inside a route.
- Behavior: named action/outcome inside a case; has canonical `kind`, with simple HTTP response kind inferred.

Collections stay simple. They select behavior addresses; behavior details live in route files.

## Matching and selection

Resolved collection route order is semantic. Active entries are checked bottom-to-top; the last
matching selected case wins. This enables fallback/override behavior.

Prototype may do this silently. Future validation should detect shadowing/ambiguity where feasible
and explain runtime matching decisions clearly.

## HTTP milestone scope

Ship first:

- YAML/JSON route files and collections file.
- HTTP `transport`.
- Route/case/behavior loading and validation.
- Collections with `id`, `from`, `routes`.
- `routes` entries as `route:case:behavior`; structured form optional.
- No implicit defaults for case/behavior.
- Response and passthrough behavior kinds.
- Fail-closed miss with descriptive diagnostic response.
- Sessions via `x-mock-session`.
- Control: `useCollection`, `useRoute`, `reset`.
- Golden tests for matching, response plan, collection inheritance/order, passthrough plan, and session isolation.

## Roadmap, not first milestone

- Flow/sequences, likely as a `behavior.kind`.
- WebSocket/SSE/gRPC transports.
- Recording/import/export.
- Codec plugins.
- Data transform plugins.
- Protocol plugins.
- Browser extension/UI.

## Plugin posture

Decoy is a mock tool with plugins for advanced cases, not a plugin framework first.

The broad future extension seam is the plugin pipeline: ordered stages that may adapt transport data
before or after Decoy's core matching and behavior semantics. The first likely stage is a codec
stage: `wire bytes <-> logical message`. This keeps complicated WebSocket/msgpack/protobuf plumbing
out of route YAML while preserving simple route/case/behavior UX. Message transform stages are also
part of the broader pipeline model, but they must not redefine core matching/session semantics.

Herdr-style external command plugins are attractive for early pipeline stages: manifest + executable
command + host-provided context/API. Avoid broad lifecycle hooks until Decoy's own semantics are
stable.
