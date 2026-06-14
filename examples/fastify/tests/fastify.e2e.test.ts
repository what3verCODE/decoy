import { afterAll, beforeAll, describe, expect, test } from '@rstest/core'
import { type RunningApp, startApp } from './harness'

describe('examples/fastify — in-process plugin: serve mocks, fall through, fail closed', () => {
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
    app.control.setCollection('error-state')

    const errored = await fetch(`${app.base}/users/42`)
    expect(errored.status).toBe(500)
    expect(await errored.json()).toEqual({ error: 'upstream exploded' })

    // Restore the baseline scenario for the following tests.
    app.control.setCollection('happy-path')
    expect((await fetch(`${app.base}/users/42`)).status).toBe(200)
  })

  test('an unmocked route falls through to the real host route', async () => {
    const response = await fetch(`${app.base}/health`)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok', from: 'host app' })
  })

  test('a route neither mocked nor handled fails closed (501 + x-mock-miss)', async () => {
    const miss = await fetch(`${app.base}/orders`)

    // No real route owns `/orders`, so the request lands in the plugin's not-found
    // handler and fails closed (ADR-0005) — unlike express's pure fall-through, this
    // is Fastify's natural lifecycle. Nothing reaches a real API, because there is
    // none — that is the whole point of the mock.
    expect(miss.status).toBe(501)
    expect(miss.headers.get('x-mock-miss')).toBe('true')
    expect(await miss.json()).toHaveProperty('error')
  })
})
