import { afterEach, beforeEach, describe, expect, test } from '@rstest/core'
import { SESSION_HEADER } from './router'
import { createSessionRouter } from './session-router'
import { startTestServer, type TestServer } from './test-server'

describe('SessionRouter — transport-agnostic control over /__decoy__', () => {
  let s: TestServer

  beforeEach(async () => {
    s = await startTestServer()
  })

  afterEach(async () => {
    await s.stop()
  })

  test('creates a session and exposes its id + header', async () => {
    const router = await createSessionRouter({ baseUrl: s.base })

    expect(typeof router.id).toBe('string')
    expect(router.id.length).toBeGreaterThan(0)
    expect(router.headers).toEqual({ [SESSION_HEADER]: router.id })

    await router.destroy()
  })

  test('useCollection scopes the switch to this session only', async () => {
    const router = await createSessionRouter({ baseUrl: s.base })

    await router.useCollection('error-state')

    // The session sees error-state; the global session is untouched.
    expect((await s.user(router.id)).status).toBe(500)
    expect((await s.user()).status).toBe(200)

    await router.destroy()
  })

  test('useRoute and reset are session-scoped', async () => {
    const router = await createSessionRouter({ baseUrl: s.base })

    await router.useRoute('users-by-id', 'default', 'error')
    expect((await s.user(router.id)).status).toBe(500)

    await router.reset()
    expect((await s.user(router.id)).status).toBe(200)

    await router.destroy()
  })

  test('stampOn applies the session header to a context (transparent injection)', async () => {
    const router = await createSessionRouter({ baseUrl: s.base })
    let captured: Record<string, string> | undefined
    const context = {
      async setExtraHTTPHeaders(headers: Record<string, string>) {
        captured = headers
      },
    }

    await router.stampOn(context)

    expect(captured).toEqual({ [SESSION_HEADER]: router.id })

    await router.destroy()
  })

  test('parallel routers drive isolated selections on one shared server', async () => {
    const [a, b, c] = await Promise.all([
      createSessionRouter({ baseUrl: s.base }),
      createSessionRouter({ baseUrl: s.base }),
      createSessionRouter({ baseUrl: s.base }),
    ])

    // Each switches concurrently; ids must be distinct.
    expect(new Set([a.id, b.id, c.id]).size).toBe(3)
    await Promise.all([
      a.useCollection('error-state'),
      b.useRoute('users-by-id', 'default', 'error'),
      // c stays on the baseline
    ])

    const [ra, rb, rc] = await Promise.all([s.user(a.id), s.user(b.id), s.user(c.id)])
    expect(ra.status).toBe(500)
    expect(rb.status).toBe(500)
    expect(rc.status).toBe(200)

    await Promise.all([a.destroy(), b.destroy(), c.destroy()])
  })

  test('destroy removes the session; a destroyed id falls back to the baseline', async () => {
    const router = await createSessionRouter({ baseUrl: s.base })
    await router.useCollection('error-state')
    const id = router.id
    expect((await s.user(id)).status).toBe(500)

    await router.destroy()

    // The session is gone; the server lazily re-creates a baseline session for the id.
    expect((await s.user(id)).status).toBe(200)
  })

  test('adopts a pre-created session id instead of creating one', async () => {
    const first = await createSessionRouter({ baseUrl: s.base })
    await first.useCollection('error-state')

    const adopted = await createSessionRouter({ baseUrl: s.base, sessionId: first.id })
    expect(adopted.id).toBe(first.id)
    // Adopting shares the same selection, not a fresh one.
    expect((await adopted.useCollection('error-state')).collection).toBe('error-state')
    expect((await s.user(adopted.id)).status).toBe(500)

    await adopted.destroy()
  })
})
