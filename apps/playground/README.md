# @decoy/playground

The **dogfood target**: a real example app whose API base URL points at a Decoy
instance, plus the e2e harness the Router slices assert through.

- `src/app.ts` — a thin BFF that calls an upstream users API (`apiBaseUrl`) and
  transforms the result. In the dogfood setup that base URL points at Decoy, so
  the app develops against deterministic mocks instead of a live backend.
- `mocks/` + `decoy.config.ts` — the contract the app is built against
  (`users-by-id` route, `happy-path`/`error-state` collections).
- `src/main.ts` — boots Decoy + the app together. `pnpm --filter @decoy/playground start`,
  then `curl http://localhost:3000/profile`.
- `e2e/harness.ts` — `startHarness()` boots the whole stack on ephemeral ports and
  returns live base URLs + a `stop()` teardown. Drive control over `/admin`
  (`adminBase`) or in-process (`decoy.control`).
- `e2e/smoke.e2e.test.ts` — asserts, through the running stack: a served variant,
  control switching the scenario the app sees next, and a fail-closed miss
  surfacing both through the app and at the Decoy boundary.

Run the e2e: `pnpm --filter @decoy/playground test`.
