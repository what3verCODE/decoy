# GitHub issue reset plan

Status: prepared because the current `gh` token can read issues but cannot close/comment/create them.

## Close as obsolete

Use reason: `not planned`.

Closing comment:

> Closing as obsolete after the strategic reset captured in `CONTEXT.md`,
> `docs/design/next-direction.md`, and
> `docs/adr/0001-rust-runtime-and-semantic-model.md`.
>
> Decoy is moving toward a native runtime prototype and the
> `collection -> route -> case -> behavior` model. Narrower replacement issues
> track the new direction.

Issues:

- #1 PRD: Decoy v1 — contract-first HTTP mock (whole-v1 umbrella)
- #43 TestplaneRouter + e2e
- #82 Lift the catalog read-model out of the HTTP dispatcher
- #87 Decide how @decoy/ui dev server mocks the /__decoy__ panel control API
- #88 Configurable tile dashboard for the control panel
- #105 Share the control-API wire contract between server/client

## Open replacement issues

### Native Rust runtime prototype

Labels: `enhancement`, `hitl`

Body:

```md
Build the next Decoy runtime prototype as a native Rust CLI/server.

Scope:
- load YAML/JSON route files and collections file;
- implement `collection -> route -> case -> behavior` model;
- support HTTP transport first;
- session selection via `x-mock-session`;
- control verbs: `useCollection`, `useRoute`, `reset`;
- fail-closed miss diagnostics;
- explicit passthrough behavior.

Non-goals:
- WebSocket/gRPC/SSE;
- plugins;
- recording;
- browser extension/UI;
- compatibility with old preset/variant docs.

References:
- `CONTEXT.md`
- `docs/design/next-direction.md`
- `docs/adr/0001-rust-runtime-and-semantic-model.md`
```

### Route/case/behavior schema

Labels: `enhancement`, `hitl`

Body:

```md
Define and validate the new route file schema.

Target model:
- route file has explicit `id`;
- route has exactly one top-level `transport`;
- route `match` answers where/address;
- case `match` answers which input shape;
- behavior has canonical `kind`, with simple HTTP responses inferred.

HTTP example:

```yaml
id: get-user
transport: http
match:
  method: GET
  path: /users/{id}

cases:
  user-123:
    match:
      pathParams:
        id: "123"
    behaviors:
      success:
        status: 200
        body:
          id: "123"
```

References:
- `CONTEXT.md`
- `docs/design/next-direction.md`
```

### Collection inheritance and order-based matching

Labels: `enhancement`

Body:

```md
Implement collections as one YAML file containing an array of:

```yaml
- id: string
  from: optional-parent-id
  routes:
    - route:case:behavior
```

Rules:
- route references are explicit `route:case:behavior` addresses;
- structured route references may be supported as sugar;
- no implicit default case/behavior;
- IDs used in addresses cannot contain `:`;
- `from` resolves parent first, child/local entries later;
- after resolution, entries are checked bottom-to-top;
- last matching selected case wins.

Future:
- warn/error when Decoy can prove broad later cases shadow specific earlier cases.
```

### HTTP behavior execution and passthrough

Labels: `enhancement`

Body:

```md
Implement HTTP behavior execution for the Rust runtime.

Behavior kinds now:
- `response` — static JSON/text response;
- `passthrough` — explicit upstream passthrough.

Rules:
- JSON object/array bodies default to `content-type: application/json`;
- text responses are supported;
- file/binary responses are future work;
- a miss fails closed with diagnostic status/body/header;
- passthrough target resolution order is behavior override -> route override -> global runtime config -> request metadata/original host.
```

### Golden semantic tests

Labels: `enhancement`, `ready-for-agent`

Body:

```md
Create golden tests for the semantic contract before expanding the rewrite.

Required surfaces:
- route/case/behavior selection;
- response plan generation;
- collection `from` inheritance;
- bottom-to-top matching order;
- passthrough plan resolution;
- fail-closed miss shape;
- per-session isolation;
- control verbs: `useCollection`, `useRoute`, `reset`.

These tests define intentional Decoy behavior. Current TS implementation is prior art, not law.
```

### Plugin seam design: codec plugins first

Labels: `enhancement`, `hitl`

Body:

```md
Design the future plugin seam without implementing a full plugin framework yet.

Posture:
- Decoy is a mock tool with plugins for advanced cases, not a plugin framework first.
- First likely plugin type: codec plugin (`bytes <-> logical message`).
- Target use case: WebSocket messages with msgpack envelope and service-specific protobuf/JSON payloads.

Explore:
- Herdr-style manifest + executable command model;
- JSON-over-stdio protocol;
- timeout/error/log behavior;
- plugin ID resolution;
- how route YAML references codecs without embedding protocol plumbing.

Non-goals:
- arbitrary lifecycle hooks;
- UI plugins;
- custom matchers that redefine core semantics.
```
