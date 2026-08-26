# Native Control API endpoint shape

Status: implementation decision for the Rust HTTP runtime prototype.

## Decision

The native prototype exposes command-shaped Controller verbs below the reserved `/__decoy__` path namespace:

| Verb | Request | Body |
| --- | --- | --- |
| `useCollection` | `POST /__decoy__/control/useCollection` | `{ "collection": "<collection-id>" }` |
| `useRoute` | `POST /__decoy__/control/useRoute` | `{ "route": "<route-id>", "case": "<case-id>", "behavior": "<behavior-id>" }` |
| `reset` | `POST /__decoy__/control/reset` | empty or omitted JSON body |

Callers identify the Session to mutate with the canonical `x-mock-session` header. Missing or blank values target the default Session.

Successful responses return HTTP `200` with the resulting Selection snapshot as JSON. Invalid JSON, unknown Collections, and unknown Behavior addresses return HTTP `400` with `{ "error": "<clear message>" }`. Unknown control paths return HTTP `404` with the same error envelope.

## Rationale

Controller verbs are command-shaped in the domain model: `useCollection`, `useRoute`, and `reset` mutate a per-Session Selection rather than managing durable REST resources. A command-shaped prototype API keeps that vocabulary visible and avoids prematurely freezing a public REST resource model.

REST-shaped endpoints remain a possible future public contract once catalog/read-model inspection, UI needs, and adapter compatibility are clearer. For the native runtime prototype, the command-shaped API is intentionally narrow and mirrors only the Controller verbs required by the HTTP milestone.

## Prototype boundary

This records the prototype endpoint shape, not a permanent public API freeze. The stable semantic contract is the Controller behavior: per-Session Selection, active Collection switching, per-route/case Behavior overrides, and reset clearing overrides while preserving active Collection semantics.
