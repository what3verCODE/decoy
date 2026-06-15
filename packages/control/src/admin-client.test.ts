import { afterEach, beforeEach, describe, expect, test } from '@rstest/core'
import { createAdminClient } from './admin-client'
import { startTestServer, type TestServer } from './test-server'

describe('AdminClient — typed client over the /admin HTTP API', () => {
  let s: TestServer

  beforeEach(async () => {
    s = await startTestServer()
  })

  afterEach(async () => {
    await s.stop()
  })

  test('getSelection reads the current selection', async () => {
    const client = createAdminClient({ baseUrl: s.base })
    expect(await client.getSelection()).toEqual({ collection: 'happy-path', overrides: [] })
  })

  test('useCollection switches the active collection and returns the resulting selection', async () => {
    const client = createAdminClient({ baseUrl: s.base })

    const selection = await client.useCollection('error-state')

    expect(selection).toEqual({ collection: 'error-state', overrides: [] })
    expect((await s.user()).status).toBe(500)
  })

  test('useRoute pins a route override the next request sees', async () => {
    const client = createAdminClient({ baseUrl: s.base })

    const selection = await client.useRoute('users-by-id', 'default', 'error')

    expect(selection.overrides).toEqual([
      { route: 'users-by-id', preset: 'default', variant: 'error' },
    ])
    expect((await s.user()).status).toBe(500)
  })

  test('reset drops overrides back to the active collection baseline', async () => {
    const client = createAdminClient({ baseUrl: s.base })
    await client.useRoute('users-by-id', 'default', 'error')
    expect((await s.user()).status).toBe(500)

    const selection = await client.reset()

    expect(selection).toEqual({ collection: 'happy-path', overrides: [] })
    expect((await s.user()).status).toBe(200)
  })

  test('an unknown collection fails loud with the server error message', async () => {
    const client = createAdminClient({ baseUrl: s.base })
    await expect(client.useCollection('nope')).rejects.toThrow(/collection "nope" is not defined/)
  })

  test('createSession returns a fresh id; destroySession reports unknown ids', async () => {
    const client = createAdminClient({ baseUrl: s.base })

    const id = await client.createSession()
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)

    expect(await client.destroySession(id)).toBe(true)
    expect(await client.destroySession(id)).toBe(false)
  })

  test('a custom prefix is honored', async () => {
    const client = createAdminClient({ baseUrl: s.base, prefix: '/admin' })
    expect(await client.getSelection()).toEqual({ collection: 'happy-path', overrides: [] })
  })
})
