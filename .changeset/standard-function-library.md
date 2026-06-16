---
"@decoy/core": minor
---

Standard JMESPath function library — the registration seam, with `uuid()` as the inaugural function.

- `@decoy/core` — a built-in function library registered into the JMESPath runtime that every `${ }` template and preset predicate evaluates against, so expressions can *fabricate* data the query language cannot. v1 ships **`uuid()`** → a freshly generated RFC 4122 version 4 UUID (lowercase, hyphenated string; no arguments; non-deterministic by design). `registerStandardFunctions()` registers the set idempotently and runs once at load, so `${ uuid() }` works with no caller setup; it never clobbers a same-named function already registered. The `standardFunctions` table and `StandardFunction` type are the single place further standard functions — and a config's custom functions (#34) — are added. The set is part of the cross-language contract (a per-language client reproduces each by name + semantics).
