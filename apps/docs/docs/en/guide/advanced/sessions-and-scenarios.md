---
title: Sessions & Scenarios
description: Switch scenarios at runtime and isolate parallel tests with sessions — one shared Decoy server, no cross-talk.
---

# Sessions & Scenarios

Decoy's behavior is driven at runtime: you select which [variant](/guide/basic/core-concepts) each
route serves, and — for parallel tests — you isolate those selections per **session** so workers
sharing one server never stomp each other.

## Switching the scenario

Three verbs change what Decoy serves, and each switch is **atomic** — the *next* request sees the
new state:

- **`useCollection(name)`** — swap the whole [scenario](/guide/basic/core-concepts) at once.
- **`useRoute(route, preset, variant)`** — pin a single route's `preset` slot to a `variant`, on top
  of the active collection.
- **`reset()`** — drop all per-route overrides, back to the collection's baseline.

```ts
await router.useCollection('error-state')   // whole scenario → error
await router.useRoute('users-by-id', 'default', 'boom')  // override just one route
await router.reset()                        // back to the collection baseline
```

These are the same verbs whether you call them in-process or over HTTP — see
[Control plane](/guide/advanced/control-plane).

## The only state is the selection

Decoy's engine is **stateless**: `match(request, selection) → response` is pure given the selection.
The **selection** — the active collection plus per-route overrides — is the *only* mutable state.

There is **no per-request state** in v1: no CRUD store, no auto-advancing sequences, no call-count
logic. That's deliberate — implicit per-call state is the top cause of flaky mock tests. When you
need a sequence (first call succeeds, second fails), drive it explicitly from the test with
`useRoute` between assertions, so the order is in your code, not hidden in the mock.

## Sessions: isolating parallel tests

Plain `useCollection` mutates the **global** session — the default, and all you need for local dev.
But parallel e2e workers hitting one shared server would overwrite each other's scenario. **Sessions**
solve that: each is an isolated selection scope keyed by the `x-mock-session` header.

A session is **created** server-side, and its header is **stamped** onto the browser context so the
app's *own* `fetch`/`axios` calls carry it transparently — no application code changes:

```ts
import { createSessionRouter } from '@decoy/control'

const router = await createSessionRouter({ baseUrl: stack.decoyBaseUrl })
await router.stampOn(context)   // every request from this context now carries x-mock-session
// ...drive router.useCollection / useRoute as usual; only THIS session moves
await router.destroy()          // explicit cleanup (an idle-TTL reaper backs it up)
```

Each session owns its own selection, so flipping one session's scenario never leaks into another —
even on the same live server:

```ts
test('parallel sessions stay isolated on the shared server', async ({ browser, stack, baseURL }) => {
  const open = async () => {
    const context = await browser.newContext({ baseURL })
    const router = await createSessionRouter({ baseUrl: stack.decoyBaseUrl })
    await router.stampOn(context)
    const page = await context.newPage()
    await page.goto('/')
    return { context, router, page }
  }
  const a = await open()
  const b = await open()

  await a.router.useCollection('error-state')   // only session A moves
  // → session A now serves the error scenario; session B still serves the happy path
})
```

One shared server scales to massive parallelism with **zero** extra processes or port orchestration.
Multiple sessions are a **tests-only** concept; in dev you stay on the global session.

## Next steps

- [Control plane](/guide/advanced/control-plane) — the JS control API, its HTTP mirror, and the Router abstraction.
- [Integrations](/integrations/) — Playwright, Testplane, and server adapters that wire sessions in for you.
