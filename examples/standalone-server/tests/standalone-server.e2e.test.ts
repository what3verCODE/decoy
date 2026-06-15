import { afterAll, beforeAll, describe, expect, test } from '@rstest/core'
import { type RunningServer, startServer } from './harness'

describe('examples/standalone-server — decoy CLI + /__decoy__ control over HTTP', () => {
  let server: RunningServer

  /** Drive the running server's control plane over its HTTP `/__decoy__` API. */
  function control(path: string, body?: unknown): Promise<Response> {
    return fetch(`${server.base}/__decoy__/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  }

  beforeAll(async () => {
    server = await startServer()
  })

  afterAll(async () => {
    await server.stop()
  })

  test('serves a mocked variant from the active collection', async () => {
    const response = await fetch(`${server.base}/users/42`)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ id: 42, name: 'Ada' })
  })

  test('switching the collection over /__decoy__ flips what the next request sees', async () => {
    const switched = await control('collection', { name: 'error-state' })
    expect(switched.status).toBe(200)

    const errored = await fetch(`${server.base}/users/42`)
    expect(errored.status).toBe(500)
    expect(await errored.json()).toEqual({ error: 'upstream exploded' })

    // Restore the baseline scenario for the following tests.
    expect((await control('collection', { name: 'happy-path' })).status).toBe(200)
    expect((await fetch(`${server.base}/users/42`)).status).toBe(200)
  })

  test('a single-route override over /__decoy__, then reset, restores the baseline', async () => {
    const pinned = await control('route', {
      route: 'users-by-id',
      preset: 'default',
      variant: 'boom',
    })
    expect(pinned.status).toBe(200)
    expect((await fetch(`${server.base}/users/42`)).status).toBe(500)

    expect((await control('reset')).status).toBe(200)
    expect((await fetch(`${server.base}/users/42`)).status).toBe(200)
  })

  test('an unmocked route fails closed (501 + x-mock-miss)', async () => {
    const miss = await fetch(`${server.base}/orders`)

    expect(miss.status).toBe(501)
    expect(miss.headers.get('x-mock-miss')).toBe('true')
  })
})
