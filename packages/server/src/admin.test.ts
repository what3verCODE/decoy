import type { LoadedService, ResolvedAdmin } from '@decoy/config'
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

const happyPath: Collection = { id: 'happy-path', routes: ['users-by-id:default:success'] }
const errorState: Collection = { id: 'error-state', routes: ['users-by-id:default:error'] }

function service(admin: ResolvedAdmin = { enabled: true, prefix: '/admin' }): LoadedService {
  return {
    name: 'users',
    port: 0,
    defaultCollection: 'happy-path',
    admin,
    definitions: {
      routes: new Map([[usersRoute.id, usersRoute]]),
      collections: new Map([
        [happyPath.id, happyPath],
        [errorState.id, errorState],
      ]),
    },
  }
}

describe('/admin HTTP control API', () => {
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

  test('POST /admin/collection switches the collection; the next request reflects it atomically', async () => {
    expect((await fetch(`${base}/users/42`)).status).toBe(200)

    const control = await fetch(`${base}/admin/collection`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'error-state' }),
    })
    expect(control.status).toBe(200)
    expect(await control.json()).toEqual({ collection: 'error-state', overrides: [] })

    const switched = await fetch(`${base}/users/42`)
    expect(switched.status).toBe(500)
    expect(await switched.json()).toEqual({ error: 'boom' })
  })

  test('POST /admin/route pins one route; the next request reflects it', async () => {
    const control = await fetch(`${base}/admin/route`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ route: 'users-by-id', preset: 'default', variant: 'error' }),
    })
    expect(control.status).toBe(200)
    expect(await control.json()).toEqual({
      collection: 'happy-path',
      overrides: [{ route: 'users-by-id', preset: 'default', variant: 'error' }],
    })

    expect((await fetch(`${base}/users/42`)).status).toBe(500)
  })

  test('POST /admin/reset drops overrides back to the active collection baseline', async () => {
    await fetch(`${base}/admin/route`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ route: 'users-by-id', preset: 'default', variant: 'error' }),
    })
    expect((await fetch(`${base}/users/42`)).status).toBe(500)

    const reset = await fetch(`${base}/admin/reset`, { method: 'POST' })
    expect(reset.status).toBe(200)
    expect(await reset.json()).toEqual({ collection: 'happy-path', overrides: [] })
    expect((await fetch(`${base}/users/42`)).status).toBe(200)
  })

  test('GET /admin/selection returns the current selection', async () => {
    await fetch(`${base}/admin/collection`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'error-state' }),
    })
    const selection = await fetch(`${base}/admin/selection`)
    expect(selection.status).toBe(200)
    expect(await selection.json()).toEqual({ collection: 'error-state', overrides: [] })
  })

  test('an unknown collection is a 400, not a silent switch', async () => {
    const response = await fetch(`${base}/admin/collection`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'nope' }),
    })
    expect(response.status).toBe(400)
    expect(((await response.json()) as { error: string }).error).toContain('nope')
    // selection unchanged
    expect((await fetch(`${base}/users/42`)).status).toBe(200)
  })

  test('an unknown route/preset/variant is a 400', async () => {
    const response = await fetch(`${base}/admin/route`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ route: 'ghost', preset: 'default', variant: 'success' }),
    })
    expect(response.status).toBe(400)
    expect(((await response.json()) as { error: string }).error).toContain('ghost')
  })

  test('a malformed body is a 400', async () => {
    const response = await fetch(`${base}/admin/collection`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ not json',
    })
    expect(response.status).toBe(400)
  })

  test('missing required fields are a 400', async () => {
    const response = await fetch(`${base}/admin/collection`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(response.status).toBe(400)
  })

  test('an unknown admin endpoint is a 404', async () => {
    const response = await fetch(`${base}/admin/nope`, { method: 'POST' })
    expect(response.status).toBe(404)
  })

  test('adminPort reports the same-port mount', () => {
    expect(server.adminPort).toBe(Number(new URL(base).port))
  })
})

describe('/admin on a separate port', () => {
  let server: DecoyServer
  let mainBase: string
  let adminBase: string

  beforeEach(async () => {
    server = createServer(service({ enabled: true, prefix: '/admin', port: 0 }), { logger: silent })
    const port = await server.listen()
    mainBase = `http://localhost:${port}`
    adminBase = `http://localhost:${server.adminPort}`
  })

  afterEach(async () => {
    await server.close()
  })

  test('admin is reachable on its own port and drives the main port', async () => {
    expect(server.adminPort).not.toBe(Number(new URL(mainBase).port))

    const control = await fetch(`${adminBase}/admin/collection`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'error-state' }),
    })
    expect(control.status).toBe(200)
    expect((await fetch(`${mainBase}/users/42`)).status).toBe(500)
  })

  test('the main port does not intercept /admin — it is a normal (missed) route', async () => {
    const response = await fetch(`${mainBase}/admin/selection`)
    expect(response.status).toBe(501)
    expect(response.headers.get('x-mock-miss')).toBe('true')
  })
})

describe('/admin disabled', () => {
  let server: DecoyServer
  let base: string

  beforeEach(async () => {
    server = createServer(service({ enabled: false, prefix: '/admin' }), { logger: silent })
    const port = await server.listen()
    base = `http://localhost:${port}`
  })

  afterEach(async () => {
    await server.close()
  })

  test('adminPort is undefined and /admin is not intercepted', async () => {
    expect(server.adminPort).toBeUndefined()
    const response = await fetch(`${base}/admin/selection`)
    expect(response.status).toBe(501)
    expect(response.headers.get('x-mock-miss')).toBe('true')
  })
})
