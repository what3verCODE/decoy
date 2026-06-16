---
"@decoy/control": minor
---

Make sessions first-class on the control client; collapse the dual client (ADR-0011).

`createControlClient(...)` replaces `createAdminClient(...)`: its own `useCollection`/`useRoute`/`reset` drive the **global** (dev) session, and `createSession()` now returns a first-class **session handle** — a `Router` plus `id`/`headers`/`stampOn`/`destroy` — instead of a bare id string. `session(id)` adopts an existing id with no server round-trip. `createSessionRouter(...)` stays as the one-call sugar over `createControlClient(...).createSession()`, so existing Playwright fixtures keep working verbatim; the dual `lifecycle`+`control` client construction it used disappears.

- `createAdminClient` → **`createControlClient`**; `AdminClient` → **`ControlClient`**; `AdminClientOptions` → **`ControlClientOptions`** (and `admin-client.ts` → `control-client.ts`).
- `SessionRouter.sessionId` → **`SessionRouter.id`** (matches DESIGN §9's `session.id`); `HeaderSink`/`SessionRouter` are interface-only declarations now living alongside `Router`.
- The session-scoped `ControlClientOptions.sessionId` and the standalone `destroySession(id)` method are dropped — adopt via `client.session(id)` and tear down via the handle's `destroy()`.

**Breaking:** `createAdminClient`/`AdminClient`/`AdminClientOptions`, `SessionRouter.sessionId`, the `sessionId` client option, `createSession()`'s string return, and `destroySession`. Pre-release — no deprecation path.
