---
"@decoy/playwright": minor
---

`createPlaywrightRouter` / `createRouterFixture` load mocks from `decoy.config.*` themselves.

The only required argument is now the Playwright `target` (page/context) — the router loads the project's `decoy.config.*` (the same yaml/json sources the server reads) and serves those definitions. `createRouterFixture()` takes no required arguments and discovers the config from `process.cwd()`.

**Breaking:** the in-code `definitions` / `defaultCollection` options are removed, along with the `missStatus` override (the fail-closed miss status now comes solely from the config). Callers that hand-built definitions must move them into a `decoy.config.*` (a per-test config can be written to a temp dir and passed via the new `configPath` option). New options: `configPath`, `cwd`. The `url` option (which browser requests this router intercepts — a Playwright transport concern) is unchanged.
