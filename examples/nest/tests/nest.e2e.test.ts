import { afterAll, beforeAll, describe, expect, test } from '@rstest/core'
import { type RunningApp, startApp } from './harness'

describe('examples/nest — in-process module: serve mocks, fall through on miss', () => {
  let app: RunningApp

  beforeAll(async () => {
    app = await startApp()
  })

  afterAll(async () => {
    await app.stop()
  })

  test('serves a mocked variant from the active collection', async () => {
    const response = await fetch(`${app.base}/users/42`)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(await response.json()).toEqual({ id: 42, name: 'Ada' })
  })

  test('switching the collection in-process flips what the next request sees', async () => {
    app.control.useCollection('error-state')

    const errored = await fetch(`${app.base}/users/42`)
    expect(errored.status).toBe(500)
    expect(await errored.json()).toEqual({ error: 'upstream exploded' })

    // Restore the baseline scenario for the following tests.
    app.control.useCollection('happy-path')
    expect((await fetch(`${app.base}/users/42`)).status).toBe(200)
  })

  test('an unmocked route falls through to the real host controller', async () => {
    const response = await fetch(`${app.base}/health`)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok', from: 'host app' })
  })

  test('a route neither mocked nor handled is the host app’s 404 (no real API to leak to)', async () => {
    const miss = await fetch(`${app.base}/orders`)

    // In-process the module falls through on a miss; with no downstream handler the
    // host app answers 404 (its own fail-closed). Nothing reaches a real API, because
    // there is none — that is the whole point of the mock.
    expect(miss.status).toBe(404)
  })
})
