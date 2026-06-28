# @decoy/core

The pure engine: `match(request, selection) → response`, plus the domain types, path matching, and
`${ }` templating. **Zero IO** — a guard (`pnpm check`) enforces no Node built-ins.

**Role** · the heart every other package wraps with a transport.
**Exports** · `createEngine`, `createController`, `matchPath`/`compilePath`, `buildResponse`,
`resolveCollection`, the template + standard-function helpers, and all domain types (`Route`,
`Variant`, `Selection`, `Definitions`, …).
**Depends on** · nothing.
**Used by** · every `@decoy/*` package.

Concepts → `/guide/basic/core-concepts`. Generated API → `/reference/api/`.
