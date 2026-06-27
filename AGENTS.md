# AGENTS.md

Operating manual for agents working in the **decoy** monorepo. This file is a pointer, not
an explainer — for what Decoy is and how it works, read the docs (see below).

## The docs are the explainer

The user documentation site (`apps/docs/`) is the single source of prose. It emits
an AI surface you should read before answering questions about behaviour:

- **`/llms.txt`** — index of every page as plain text.
- **`/llms-full.txt`** — the whole site concatenated.
- A per-page `.md` next to every route (e.g. `/guide/start/introduction.md`).

Build it locally with `pnpm docs:build`; the surface lands at `apps/docs/dist/llms.txt`. The hosted URL is deferred until the site is
deployed — point your agent at the built file or the deployed `/llms.txt` once it exists.

## Toolchain

pnpm@11 · Node ≥24. Install with `pnpm install` (use `--frozen-lockfile` in CI).

## Commands

| command | what it does |
| --- | --- |
| `pnpm build` | build every workspace package (includes `apps/docs` — the docs dead-link check is the docs test seam) |
| `pnpm check` | Biome lint/format + `@decoy/core-purity` guard |
| `pnpm typecheck` | type-check every package |
| `pnpm test` | unit/integration tests across packages |
| `pnpm fix` | apply Biome autofixes |
| `pnpm docs:build` | build just the docs site (`@decoy/docs`) |
| `pnpm --filter @decoy/docs dev` | run the docs dev server |

Examples (`examples/*`) are the e2e tier and run their own `test:e2e` per workspace.

## Conventions

- Conventional Commits; small vertical-slice PRs.
- `@decoy/*` is the package scope; the CLI bin is `decoy`.
- Don't reach for the real network in tests — Decoy is fail-closed by default.
