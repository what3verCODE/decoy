# AGENTS.md

Operating manual for agents working in the **decoy** monorepo.

## Read this before behavioral work

- `CONTEXT.md` is the normative glossary. Read it before changing schemas, public APIs, docs,
  adapters, or issue text that names Decoy concepts.
- `docs/design/` holds working design notes. Read the relevant note before implementing roadmap or
  architecture changes.
- `docs/adr/` holds accepted architectural decisions. Read ADRs before reversing or replacing a
  recorded decision.

## Agent skills

### Issue tracker

Issues and specs are tracked in GitHub Issues for `what3verCODE/decoy`. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the default five-label triage vocabulary. See `docs/agents/triage-labels.md`.

### Domain docs

This repo uses a single-context domain model: root `CONTEXT.md` plus root `docs/adr/`. See `docs/agents/domain.md`.

## Toolchain

pnpm@11 · Node ≥24. Install with `pnpm install` (use `--frozen-lockfile` in CI).

## Commands

| command | what it does |
| --- | --- |
| `pnpm build` | build every workspace package |
| `pnpm check` | Biome lint/format + project guards |
| `pnpm typecheck` | type-check every package |
| `pnpm test` | unit/integration tests across packages |
| `pnpm fix` | apply Biome autofixes |

Examples (`examples/*`) are the e2e tier and run their own `test:e2e` per workspace.

## Conventions

- Conventional Commits; small vertical-slice PRs.
- `@decoy/*` is the package scope; the CLI bin is `decoy`.
- Don't reach for the real network in tests — Decoy is fail-closed by default.
