import type { LoadedService } from '@decoy/config'
import type { Collection, Route } from '@decoy/core'
import { afterEach, beforeEach, describe, expect, test } from '@rstest/core'
import type { Logger } from './logger'
import { createServer, type DecoyServer } from './server'

const silent: Logger = { info() {}, warn() {}, request() {} }

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

function service(): LoadedService {
  return {
    name: 'users',
    port: 0,
    defaultCollection: 'happy-path',
    missStatus: 501,
    admin: { enabled: true, prefix: '/admin' },
    sessionIdleTtlMs: 1_800_000,
    definitions: {
      routes: new Map([[usersRoute.id, usersRoute]]),
      collections: new Map([
        [happyPath.id, happyPath],
        [errorState.id, errorState],
      ]),
    },
  }
}

describe('sessions over HTTP', () => {
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

  async function createSession(): Promise<string> {
    const res = await fetch(`${base}/admin/sessions`, { method: 'POST' })
    expect(res.status).toBe(201)
    return ((await res.json()) as { id: string }).id
  }

  function switchCollection(name: string, sessionId?: string): Promise<Response> {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (sessionId) {
      headers['x-mock-session'] = sessionId
    }
    return fetch(`${base}/admin/collection`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name }),
    })
  }

  test('POST /admin/sessions creates a session with an id', async () => {
    const id = await createSession()
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
  })

  test('a request carrying x-mock-session resolves against that session', async () => {
    const id = await createSession()
    expect((await switchCollection('error-state', id)).status).toBe(200)

    // The session sees error-state...
    const scoped = await fetch(`${base}/users/42`, { headers: { 'x-mock-session': id } })
    expect(scoped.status).toBe(500)

    // ...while the default (no-header) global session is untouched.
    expect((await fetch(`${base}/users/42`)).status).toBe(200)
  })

  test('concurrent sessions are isolated — switching one does not affect another', async () => {
    const a = await createSession()
    const b = await createSession()
    await switchCollection('error-state', a)

    expect((await fetch(`${base}/users/42`, { headers: { 'x-mock-session': a } })).status).toBe(500)
    expect((await fetch(`${base}/users/42`, { headers: { 'x-mock-session': b } })).status).toBe(200)
  })

  test('setCollection with no session header mutates the global session', async () => {
    expect((await switchCollection('error-state')).status).toBe(200)
    expect((await fetch(`${base}/users/42`)).status).toBe(500)
    // A fresh session still starts from the default collection, not the global mutation.
    const id = await createSession()
    expect((await fetch(`${base}/users/42`, { headers: { 'x-mock-session': id } })).status).toBe(
      200,
    )
  })

  test('GET /admin/selection is session-scoped', async () => {
    const id = await createSession()
    await switchCollection('error-state', id)

    const scoped = await fetch(`${base}/admin/selection`, { headers: { 'x-mock-session': id } })
    expect(await scoped.json()).toEqual({ collection: 'error-state', overrides: [] })

    const global = await fetch(`${base}/admin/selection`)
    expect(await global.json()).toEqual({ collection: 'happy-path', overrides: [] })
  })

  test('DELETE /admin/sessions/{id} destroys a session; unknown is a 404', async () => {
    const id = await createSession()
    const destroyed = await fetch(`${base}/admin/sessions/${id}`, { method: 'DELETE' })
    expect(destroyed.status).toBe(200)

    const missing = await fetch(`${base}/admin/sessions/${id}`, { method: 'DELETE' })
    expect(missing.status).toBe(404)
  })
})
