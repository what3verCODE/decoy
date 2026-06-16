import { afterEach, beforeEach, describe, expect, test } from '@rstest/core'
import { createControlClient } from './control-client'
import { SESSION_HEADER } from './router'
import { startTestServer, type TestServer } from './test-server'

describe('ControlClient — typed client over the control HTTP API', () => {
  let s: TestServer

  beforeEach(async () => {
    s = await startTestServer()
  })

  afterEach(async () => {
    await s.stop()
  })

  test('getSelection reads the current (global) selection', async () => {
    const client = createControlClient({ baseUrl: s.base })
    expect(await client.getSelection()).toEqual({ collection: 'happy-path', overrides: [] })
  })

  test('useCollection switches the global collection and returns the resulting selection', async () => {
    const client = createControlClient({ baseUrl: s.base })

    const selection = await client.useCollection('error-state')

    expect(selection).toEqual({ collection: 'error-state', overrides: [] })
    expect((await s.user()).status).toBe(500)
  })

  test('useRoute pins a global route override the next request sees', async () => {
    const client = createControlClient({ baseUrl: s.base })

    const selection = await client.useRoute('users-by-id', 'default', 'error')

    expect(selection.overrides).toEqual([
      { route: 'users-by-id', preset: 'default', variant: 'error' },
    ])
    expect((await s.user()).status).toBe(500)
  })

  test('reset drops overrides back to the active collection baseline', async () => {
    const client = createControlClient({ baseUrl: s.base })
    await client.useRoute('users-by-id', 'default', 'error')
    expect((await s.user()).status).toBe(500)

    const selection = await client.reset()

    expect(selection).toEqual({ collection: 'happy-path', overrides: [] })
    expect((await s.user()).status).toBe(200)
  })

  test('an unknown collection fails loud with the server error message', async () => {
    const client = createControlClient({ baseUrl: s.base })
    await expect(client.useCollection('nope')).rejects.toThrow(/collection "nope" is not defined/)
  })

  test('createSession returns a session handle with an id + header', async () => {
    const client = createControlClient({ baseUrl: s.base })

    const session = await client.createSession()

    expect(typeof session.id).toBe('string')
    expect(session.id.length).toBeGreaterThan(0)
    expect(session.headers).toEqual({ [SESSION_HEADER]: session.id })

    await session.destroy()
  })

  test('a session handle scopes control to its own selection, leaving global untouched', async () => {
    const client = createControlClient({ baseUrl: s.base })

    const session = await client.createSession()
    await session.useCollection('error-state')

    expect((await s.user(session.id)).status).toBe(500)
    expect((await s.user()).status).toBe(200)

    await session.destroy()
  })

  test('session(id) adopts an id synchronously without a server round-trip', async () => {
    const client = createControlClient({ baseUrl: s.base })
    const created = await client.createSession()
    await created.useCollection('error-state')

    // Adopting takes no await — it is a pure handle over the same id.
    const adopted = client.session(created.id)
    expect(adopted.id).toBe(created.id)
    // It shares the created session's selection, not a fresh one.
    expect((await s.user(adopted.id)).status).toBe(500)

    await adopted.destroy()
  })

  test('handle.destroy removes the session; the id falls back to the baseline', async () => {
    const client = createControlClient({ baseUrl: s.base })
    const session = await client.createSession()
    await session.useCollection('error-state')
    expect((await s.user(session.id)).status).toBe(500)

    await session.destroy()

    // The server lazily re-creates a baseline session for the now-unknown id.
    expect((await s.user(session.id)).status).toBe(200)
  })

  test('handle.stampOn applies the session header to a context', async () => {
    const client = createControlClient({ baseUrl: s.base })
    const session = await client.createSession()
    let captured: Record<string, string> | undefined
    await session.stampOn({
      async setExtraHTTPHeaders(headers: Record<string, string>) {
        captured = headers
      },
    })

    expect(captured).toEqual({ [SESSION_HEADER]: session.id })

    await session.destroy()
  })

  test('a custom prefix is honored', async () => {
    // Boot a server whose control mount is at a non-default prefix and point the
    // client at it — proving the prefix flows through both ends (the escape hatch).
    const custom = await startTestServer('/control')
    try {
      const client = createControlClient({ baseUrl: custom.base, prefix: '/control' })
      expect(await client.getSelection()).toEqual({ collection: 'happy-path', overrides: [] })
    } finally {
      await custom.stop()
    }
  })
})
