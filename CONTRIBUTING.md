# Contributing to Decoy

How to run the monorepo locally and the rules a change should follow. For what Decoy **is** and
how it behaves, read the [documentation site](apps/docs) (or its built `/llms.txt`) — the docs are
the single explainer; this file stays narrow.

## Toolchain

- **pnpm 11** · **Node ≥ 24**

```sh
pnpm install            # use --frozen-lockfile in CI
```

## Commands

| Command | What it does |
| --- | --- |
| `pnpm build` | Build every workspace package (includes `apps/docs`). |
| `pnpm check` | Biome lint/format + the `@decoy/core-purity` guard. |
| `pnpm typecheck` | Type-check every package. |
| `pnpm test` | Unit/integration tests across packages. |
| `pnpm fix` | Apply Biome autofixes. |
| `pnpm docs:build` | Build just the docs site (the dead-link check is the docs test seam). |
| `pnpm --filter @decoy/docs dev` | Run the docs dev server. |

Examples (`examples/*`) are the e2e tier and run their own `test:e2e` per workspace — a browser
example also needs its Playwright binary once (`pnpm --filter <example> exec playwright install
chromium`).

## Conventions

- **Conventional Commits**, small **vertical-slice** PRs.
- `@decoy/*` is the package scope; the CLI bin is `decoy`.
- **Don't reach for the real network in tests** — Decoy is fail-closed by default; a test that
  leaks to a live upstream is a bug.
- `@decoy/core` is **IO-free** (the `pnpm check` purity guard enforces it) — keep Node built-ins out
  of it.
- Run `pnpm check` and `pnpm typecheck` before opening a PR.

## Where prose lives

User-facing rationale and behaviour belong in the docs site (`apps/docs/`), not in source comments
or scattered READMEs — the **one-explainer doctrine**. Each package carries a short structural
`README.md` (its role, exports, and dependency direction) that points into the site rather than
restating it; the generated [API reference](apps/docs/docs/en/reference) covers every exported
symbol from JSDoc.
