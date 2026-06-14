# decoy

> A fast, contract-first HTTP mock you point a base URL at.

Author mock **routes** grouped into switchable **collections**, point any base URL at it, and
develop/test against deterministic scenarios without waiting for a backend — fail-closed by default,
so a test can never silently reach the real API. First-class e2e for Playwright and Testplane, plus a
standalone server.

Published under the `@decoy/*` scope; the CLI bin is `decoy`.

## Status

Pre-implementation. This repository currently holds the monorepo infrastructure and workspace
skeleton; packages are being built out.

## Repository layout

```
apps/
  docs/         documentation site
  playground/   example app + server (dogfood e2e target)
packages/
  core/         types · engine · JMESPath templating · std fns · Router interface  (pure, no IO)
  config/       defineConfig · valibot schema · loaders
  server/       HTTP server · /admin · sessions · passthrough
  cli/          bin: start / check / --tui
  control/      admin SDK · SessionRouter base
  playwright/   PlaywrightRouter + fixtures
  testplane/    TestplaneRouter + fixtures
  express/      middleware adapter
  nest/         module adapter
  web-panel/    web panel for configuring decoy (future)
```

## CLI

```bash
decoy start [--config <path>] [--port <port>]   # boot a server from a config (or default mocks/)
decoy check [--config <path>]                    # validate config + mocks, exit non-zero on error
```

`decoy check` runs the full aggregate validation (schema, `route:preset:variant` cross-reference,
`extends` resolution, duplicate/overlapping routes, JMESPath parse) and prints every issue with its
`file:line`. It exits non-zero on any **error** and zero otherwise (warnings are reported but do not
fail), so it can gate a CI merge:

```yaml
- run: pnpm decoy check
```

## Toolchain

- **proto** pins the toolchain (Node 24, pnpm 11) — run `proto install`.
- **pnpm workspaces** for the monorepo.
- **Biome** for lint + format, **TypeScript** for types, **Changesets** for releases.

```bash
proto install          # install pinned node + pnpm
pnpm install           # install workspace deps
pnpm check             # lint + format check (biome) + core purity guard
pnpm build             # build all packages
pnpm test              # run all package tests
```

### Core purity guard

`@decoy/core` is the keystone: a pure, zero-IO engine (ADR-0002 / ADR-0014). A guard
(`tooling/core-purity`) enforces this — it scans `packages/core/src` and **fails if any source
imports a Node built-in** (`node:fs`, `http`, `crypto`, …), the IO surface a pure engine must never
reach. It runs as part of `pnpm check` (and therefore in CI); run it directly with:

```bash
pnpm --filter @decoy/core-purity run guard
```

## License

[MIT](./LICENSE)
