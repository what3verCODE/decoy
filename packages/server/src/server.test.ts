import type { LoadedService } from '@decoy/config'
import type { Collection, Route } from '@decoy/core'
import { afterEach, beforeEach, describe, expect, test } from '@rstest/core'
import type { Logger } from './logger'
import { createServer, type DecoyServer } from './server'

const silent: Logger = { info() {}, warn() {} }

const usersRoute: Route = {
  id: 'users-by-id',
  method: 'GET',
  path: '/users/{id}',
  presets: { default: {} },
  variants: {
    success: { status: 200, body: { id: 42, name: 'Ada' } },
    error: { status: 500, body: { error: 'boom' } },
  },
}

const searchRoute: Route = {
  id: 'search',
  method: 'GET',
  path: '/search',
  presets: { 'with-query': { query: { q: 'ada' } }, default: {} },
  variants: { hit: { status: 200, body: { results: [] } }, empty: { status: 200, body: {} } },
}

const happyPath: Collection = {
  id: 'happy-path',
  routes: ['users-by-id:default:success'],
}

const errorState: Collection = {
  id: 'error-state',
  routes: ['users-by-id:default:error'],
}

// activates only the conditioned preset — no catch-all — to exercise the no-preset miss
const strict: Collection = {
  id: 'strict',
  routes: ['search:with-query:hit'],
}

function service(): LoadedService {
  return {
    name: 'users',
    port: 0,
    defaultCollection: 'happy-path',
    admin: { enabled: true, prefix: '/admin' },
    definitions: {
      routes: new Map([
        [usersRoute.id, usersRoute],
        [searchRoute.id, searchRoute],
      ]),
      collections: new Map([
        [happyPath.id, happyPath],
        [errorState.id, errorState],
        [strict.id, strict],
      ]),
    },
  }
}

describe('createServer (HTTP)', () => {
  let server: DecoyServer
  let base: string

  beforeEach(async () => {
    server = createServer(service(), { logger: silent })
    const port = await server.listen()
    base = `http://localhost:${port}`
  })

  afterEach(async () => {
    await server.close()
  })

  test('serves a matched variant with inferred Content-Type and an {id} param', async () => {
    const response = await fetch(`${base}/users/42`)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(await response.json()).toEqual({ id: 42, name: 'Ada' })
  })

  test('fails closed on a miss with 501 + x-mock-miss', async () => {
    const response = await fetch(`${base}/orders`)

    expect(response.status).toBe(501)
    expect(response.headers.get('x-mock-miss')).toBe('true')
    expect(await response.json()).toEqual({ error: 'no route matched GET /orders' })
  })

  test('route matched but no active preset matched fails closed with a presets-tried diagnostic', async () => {
    server.control.setCollection('strict')
    // /search matches by method+path, but its only active preset (with-query) needs q=ada
    const response = await fetch(`${base}/search`)

    expect(response.status).toBe(501)
    expect(response.headers.get('x-mock-miss')).toBe('true')
    const body = (await response.json()) as { error: string }
    expect(body.error).toContain('route "search" matched')
    expect(body.error).toContain('with-query')
  })

  test('method mismatch is a miss', async () => {
    const response = await fetch(`${base}/users/42`, { method: 'POST' })
    expect(response.status).toBe(501)
    expect(response.headers.get('x-mock-miss')).toBe('true')
  })

  test('in-process setCollection changes the next response atomically', async () => {
    expect((await fetch(`${base}/users/42`)).status).toBe(200)

    server.control.setCollection('error-state')
    const switched = await fetch(`${base}/users/42`)
    expect(switched.status).toBe(500)
    expect(await switched.json()).toEqual({ error: 'boom' })

    server.control.reset()
    server.control.useRoute('users-by-id', 'default', 'error')
    expect((await fetch(`${base}/users/42`)).status).toBe(500)
  })
})
