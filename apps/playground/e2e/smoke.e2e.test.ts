import { afterAll, beforeAll, describe, expect, test } from '@rstest/core'
import { type Harness, startHarness } from './harness'

describe('playground dogfood e2e', () => {
  let h: Harness

  /** Drive the running server's control plane over its HTTP `/admin` API. */
  function admin(path: string, body?: unknown): Promise<Response> {
    return fetch(`${h.adminBase}/admin/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  }

  beforeAll(async () => {
    h = await startHarness()
  })

  afterAll(async () => {
    await h.stop()
  })

  test('serves a mocked variant through the running stack (app → Decoy)', async () => {
    const response = await fetch(`${h.appBase}/profile`)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ greeting: 'Hello, Ada!', userId: 42 })
  })

  test('switching collection over /admin flips the scenario the app sees next', async () => {
    expect((await fetch(`${h.appBase}/profile`)).status).toBe(200)

    const switched = await admin('collection', { name: 'error-state' })
    expect(switched.status).toBe(200)

    const errored = await fetch(`${h.appBase}/profile`)
    expect(errored.status).toBe(502)
    expect(await errored.json()).toMatchObject({ upstreamStatus: 500, mockMiss: false })

    // restore the baseline scenario for the following tests
    expect((await admin('collection', { name: 'happy-path' })).status).toBe(200)
    expect((await fetch(`${h.appBase}/profile`)).status).toBe(200)
  })

  test('a single-route override over /admin, then reset restores the baseline', async () => {
    const pinned = await admin('route', {
      route: 'users-by-id',
      preset: 'default',
      variant: 'boom',
    })
    expect(pinned.status).toBe(200)
    expect((await fetch(`${h.appBase}/profile`)).status).toBe(502)

    expect((await admin('reset')).status).toBe(200)
    expect((await fetch(`${h.appBase}/profile`)).status).toBe(200)
  })

  test('a fail-closed miss surfaces through the stack and at the Decoy boundary', async () => {
    // No route is mocked for the upstream /orders path.
    const throughApp = await fetch(`${h.appBase}/orders`)
    expect(throughApp.status).toBe(502)
    expect(await throughApp.json()).toMatchObject({ upstreamStatus: 501, mockMiss: true })

    // The same miss is loud and hard-assertable right at the Decoy boundary.
    const atDecoy = await fetch(`${h.decoyBase}/orders`)
    expect(atDecoy.status).toBe(501)
    expect(atDecoy.headers.get('x-mock-miss')).toBe('true')
  })
})
