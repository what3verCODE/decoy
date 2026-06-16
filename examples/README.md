# examples/

Per-surface **example projects** — each one a self-contained showcase of Decoy through a
single integration surface (the standalone server + `/__decoy__`, the Express middleware, the
Nest module, the Playwright router, …). They are the **e2e tier** of the test taxonomy:

- **Unit** — `packages/*/src/*.test.ts`. Fakes / hand-built definitions, no IO.
- **Integration** — colocated **in each package** (`packages/<adapter>/src/*integration*.test.ts`).
  The adapter on its *real* framework over loopback HTTP (supertest), hand-built definitions.
  A package never depends on an example.
- **E2e** — `examples/*`. The full stack through a real client, exposed as **`test:e2e` only**.

## Conventions every example follows

- A workspace member with its **own** `decoy.config.ts` + `mocks/` (and SPA, where relevant) —
  nothing shared between examples.
- A `package.json` exposing a **`test:e2e`** script and (where a human can poke it) a `dev`
  script. No plain `test` script: the fast inner loop (`pnpm test`) covers packages only and
  must never boot an example or a browser.
- A doc-grade `README.md`: the single command to run, what to `curl` / open, and which feature
  each step proves. No ADR references — examples teach the surface, not the decisions.

## Running

```sh
pnpm test:e2e                          # every example's test:e2e
pnpm --filter ./examples/<name> dev    # boot one example to poke by hand
```

CI runs one job per example (a matrix over `examples/*`); browser-based examples install
Chromium in their own job. This directory ships the structure — individual examples land in
their own issues.
