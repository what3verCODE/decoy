import type { LoadedService, ResolvedAdmin } from '@decoy/config'
import type { Collection, Route } from '@decoy/core'
import { afterEach, beforeEach, describe, expect, test } from '@rstest/core'
import type { Logger, RequestLog } from './logger'
import { createServer, type DecoyServer } from './server'

const silent: Logger = { info() {}, warn() {}, request() {} }

interface SseEvent {
  id: string
  data: RequestLog & { seq: number }
}

/** Read SSE frames off a stream until `count` data events arrive (comments ignored). */
async function readDataEvents(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  count: number,
): Promise<SseEvent[]> {
  const decoder = new TextDecoder()
  const events: SseEvent[] = []
  let buffer = ''
  while (events.length < count) {
    const { value, done } = await reader.read()
    if (done) {
      break
    }
    buffer += decoder.decode(value, { stream: true })
    let boundary = buffer.indexOf('\n\n')
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      let id = ''
      const dataLines: string[] = []
      for (const line of frame.split('\n')) {
        if (line.startsWith('id:')) {
          id = line.slice(3).trim()
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trim())
        }
      }
      if (dataLines.length > 0) {
        events.push({ id, data: JSON.parse(dataLines.join('\n')) })
      }
      boundary = buffer.indexOf('\n\n')
    }
  }
  return events
}

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
    missStatus: 501,
    sessionIdleTtlMs: 1_800_000,
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

  test('GET /admin/routes returns the routes catalog with preset/variant counts', async () => {
    const response = await fetch(`${base}/admin/routes`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([
      {
        id: 'users-by-id',
        method: 'GET',
        path: '/users/{id}',
        presetCount: 1,
        variantCount: 2,
      },
    ])
  })

  test('GET /admin/routes lists one entry per route (not per variant), counting presets and variants', async () => {
    const multi: Route = {
      id: 'orders',
      method: 'POST',
      path: '/orders',
      presets: { valid: {}, invalid: {} },
      variants: { created: { status: 201 }, rejected: { status: 422 }, conflict: { status: 409 } },
    }
    const happy: Collection = { id: 'happy-path', routes: ['users-by-id:default:success'] }
    const local = createServer(
      {
        name: 'multi',
        port: 0,
        defaultCollection: 'happy-path',
        missStatus: 501,
        sessionIdleTtlMs: 1_800_000,
        admin: { enabled: true, prefix: '/admin' },
        definitions: {
          routes: new Map([
            [usersRoute.id, usersRoute],
            [multi.id, multi],
          ]),
          collections: new Map([[happy.id, happy]]),
        },
      },
      { logger: silent },
    )
    const port = await local.listen()
    try {
      const response = await fetch(`http://localhost:${port}/admin/routes`)
      expect(await response.json()).toEqual([
        { id: 'users-by-id', method: 'GET', path: '/users/{id}', presetCount: 1, variantCount: 2 },
        { id: 'orders', method: 'POST', path: '/orders', presetCount: 2, variantCount: 3 },
      ])
    } finally {
      await local.close()
    }
  })

  test('GET /admin/routes/{id} returns the route presets and variants in full', async () => {
    const response = await fetch(`${base}/admin/routes/users-by-id`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      id: 'users-by-id',
      method: 'GET',
      path: '/users/{id}',
      presets: { default: {} },
      variants: {
        success: { status: 200, body: { id: 42, name: 'Ada' } },
        error: { status: 500, body: { error: 'boom' } },
      },
    })
  })

  test('GET /admin/routes/{id} is a 404 for an unknown route', async () => {
    const response = await fetch(`${base}/admin/routes/ghost`)
    expect(response.status).toBe(404)
    expect(((await response.json()) as { error: string }).error).toContain('ghost')
  })

  test('POST /admin/try resolves through the real engine, byte-identical to a live request', async () => {
    const live = await fetch(`${base}/users/42`)
    const liveBody = await live.json()

    const tried = await fetch(`${base}/admin/try`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'GET', path: '/users/42' }),
    })
    expect(tried.status).toBe(200)
    expect(await tried.json()).toEqual({
      resolution: 'users-by-id:default:success',
      response: {
        status: live.status,
        headers: { 'content-type': live.headers.get('content-type') },
        body: liveBody,
      },
    })
  })

  test("POST /admin/try honors the caller's (session-scoped) selection", async () => {
    await fetch(`${base}/admin/collection`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'error-state' }),
    })

    const tried = await fetch(`${base}/admin/try`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'GET', path: '/users/42' }),
    })
    expect(await tried.json()).toEqual({
      resolution: 'users-by-id:default:error',
      response: {
        status: 500,
        headers: { 'content-type': 'application/json' },
        body: { error: 'boom' },
      },
    })
  })

  test('POST /admin/try honestly reports a fail-closed miss with the diagnostic response', async () => {
    const tried = await fetch(`${base}/admin/try`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'GET', path: '/nope' }),
    })
    expect(tried.status).toBe(200)
    const result = (await tried.json()) as {
      resolution: string
      response: { status: number; headers: Record<string, string>; body: { error: string } }
    }
    expect(result.resolution).toBe('MISS(no-route)')
    expect(result.response.status).toBe(501)
    expect(result.response.headers['x-mock-miss']).toBe('true')
    expect(result.response.body.error).toContain('no route matched GET /nope')
  })

  test('POST /admin/try has zero side effects — the dry-run is excluded from the log stream', async () => {
    // Fire dry-runs (a match and a miss) before opening the stream.
    await (
      await fetch(`${base}/admin/try`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ method: 'GET', path: '/users/42' }),
      })
    ).text()
    await (
      await fetch(`${base}/admin/try`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ method: 'GET', path: '/nope' }),
      })
    ).text()

    const controller = new AbortController()
    const stream = await fetch(`${base}/admin/logs`, { signal: controller.signal })
    const reader = (stream.body as ReadableStream<Uint8Array>).getReader()
    try {
      // No history replays (the dry-runs were not recorded); the first event is the
      // real request fired while connected.
      await (await fetch(`${base}/users/7`)).text()
      const [first] = await readDataEvents(reader, 1)
      if (!first) {
        throw new Error('expected one record')
      }
      expect(first.data.path).toBe('/users/7')
    } finally {
      await reader.cancel()
      controller.abort()
    }
  })

  test('POST /admin/try reports PASSTHROUGH(target) without forwarding when passthrough is on', async () => {
    const local = createServer(
      { ...service(), passthrough: { url: 'https://users.real' } },
      { logger: silent },
    )
    const port = await local.listen()
    try {
      const tried = await fetch(`http://localhost:${port}/admin/try`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ method: 'GET', path: '/nope' }),
      })
      expect(await tried.json()).toEqual({
        resolution: 'PASSTHROUGH(https://users.real)',
        response: null,
      })
    } finally {
      await local.close()
    }
  })

  test('GET /admin/collections lists all collections, marking the active one with entry counts', async () => {
    const response = await fetch(`${base}/admin/collections`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([
      { name: 'happy-path', active: true, entryCount: 1 },
      { name: 'error-state', active: false, entryCount: 1 },
    ])
  })

  test('GET /admin/collections reflects the session-scoped active collection after a switch', async () => {
    await fetch(`${base}/admin/collection`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'error-state' }),
    })
    const response = await fetch(`${base}/admin/collections`)
    expect(await response.json()).toEqual([
      { name: 'happy-path', active: false, entryCount: 1 },
      { name: 'error-state', active: true, entryCount: 1 },
    ])
  })

  test('GET /admin/collections/{name} returns the resolved ordered entries after extends', async () => {
    const base2: Collection = { id: 'base', routes: ['users-by-id:default:success'] }
    const checkout: Collection = {
      id: 'checkout',
      extends: 'base',
      routes: ['users-by-id:default:error'],
    }
    const local = createServer(
      {
        name: 'scenarios',
        port: 0,
        defaultCollection: 'base',
        missStatus: 501,
        sessionIdleTtlMs: 1_800_000,
        admin: { enabled: true, prefix: '/admin' },
        definitions: {
          routes: new Map([[usersRoute.id, usersRoute]]),
          collections: new Map([
            [base2.id, base2],
            [checkout.id, checkout],
          ]),
        },
      },
      { logger: silent },
    )
    const port = await local.listen()
    try {
      const response = await fetch(`http://localhost:${port}/admin/collections/checkout`)
      expect(response.status).toBe(200)
      // The inherited users-by-id slot is overridden in place to the `error` variant.
      expect(await response.json()).toEqual({
        name: 'checkout',
        extends: 'base',
        active: false,
        entries: [{ route: 'users-by-id', preset: 'default', variant: 'error' }],
      })
    } finally {
      await local.close()
    }
  })

  test('GET /admin/collections/{name} is a 404 for an unknown collection', async () => {
    const response = await fetch(`${base}/admin/collections/nope`)
    expect(response.status).toBe(404)
    expect(((await response.json()) as { error: string }).error).toContain('nope')
  })

  test('GET /admin/logs replays request history then tails new records (SSE)', async () => {
    // Drive some requests so the store has history to replay on connect.
    await (await fetch(`${base}/users/42`)).text() // matched
    await (await fetch(`${base}/missing`)).text() // miss

    const controller = new AbortController()
    const stream = await fetch(`${base}/admin/logs`, { signal: controller.signal })
    expect(stream.status).toBe(200)
    expect(stream.headers.get('content-type')).toContain('text/event-stream')
    const reader = (stream.body as ReadableStream<Uint8Array>).getReader()
    try {
      const [matched, missed] = await readDataEvents(reader, 2)
      if (!matched || !missed) {
        throw new Error('expected two replayed records')
      }
      expect([matched.data.path, missed.data.path]).toEqual(['/users/42', '/missing'])
      expect(matched.data.outcome).toEqual({
        type: 'matched',
        address: { route: 'users-by-id', preset: 'default', variant: 'success' },
      })
      expect(missed.data.outcome.type).toBe('miss')
      expect(matched.data.status).toBe(200)
      // The SSE id carries the stored seq (stable for client dedup on reconnect).
      expect(matched.id).toBe(String(matched.data.seq))

      // A request fired while connected tails into the open stream.
      await (await fetch(`${base}/users/7`)).text()
      const [tailed] = await readDataEvents(reader, 1)
      if (!tailed) {
        throw new Error('expected one tailed record')
      }
      expect(tailed.data.path).toBe('/users/7')
      expect(tailed.data.seq).toBeGreaterThan(missed.data.seq)
    } finally {
      await reader.cancel()
      controller.abort()
    }
  })

  test('GET /admin/sessions lists the global session plus created sessions', async () => {
    // Only the global session before anything is created.
    const before = await fetch(`${base}/admin/sessions`)
    expect(before.status).toBe(200)
    expect(await before.json()).toEqual([
      { id: 'global', global: true, collection: 'happy-path', overrideCount: 0 },
    ])

    // Create one explicitly and switch it; lazily create another via a request header.
    const created = (await (await fetch(`${base}/admin/sessions`, { method: 'POST' })).json()) as {
      id: string
    }
    await fetch(`${base}/admin/collection`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-mock-session': created.id },
      body: JSON.stringify({ name: 'error-state' }),
    })
    await (await fetch(`${base}/users/42`, { headers: { 'x-mock-session': 'lazy' } })).text()

    const after = await fetch(`${base}/admin/sessions`)
    expect(await after.json()).toEqual([
      { id: 'global', global: true, collection: 'happy-path', overrideCount: 0 },
      { id: created.id, global: false, collection: 'error-state', overrideCount: 0 },
      { id: 'lazy', global: false, collection: 'happy-path', overrideCount: 0 },
    ])
  })

  test("GET /admin/sessions/{id}/logs returns that session's records, ordered", async () => {
    const { id } = (await (await fetch(`${base}/admin/sessions`, { method: 'POST' })).json()) as {
      id: string
    }

    // Two requests on the session, one on the global session (must be excluded).
    await (await fetch(`${base}/users/1`, { headers: { 'x-mock-session': id } })).text()
    await (await fetch(`${base}/users/2`)).text() // global — different session
    await (await fetch(`${base}/missing`, { headers: { 'x-mock-session': id } })).text()

    const response = await fetch(`${base}/admin/sessions/${id}/logs`)
    expect(response.status).toBe(200)
    const records = (await response.json()) as Array<RequestLog & { seq: number }>
    // Only this session's records, oldest-first (seq ascending).
    expect(records.map((r) => r.path)).toEqual(['/users/1', '/missing'])
    expect(records.every((r) => r.session === id)).toBe(true)
    expect(records[0]?.seq).toBeLessThan(records[1]?.seq as number)
  })

  test('GET /admin/sessions/{id}/logs survives the session being destroyed', async () => {
    const { id } = (await (await fetch(`${base}/admin/sessions`, { method: 'POST' })).json()) as {
      id: string
    }
    await (await fetch(`${base}/users/9`, { headers: { 'x-mock-session': id } })).text()

    // Destroy the session; the memory store keeps records (logs decoupled from lifecycle).
    expect((await fetch(`${base}/admin/sessions/${id}`, { method: 'DELETE' })).status).toBe(200)

    const response = await fetch(`${base}/admin/sessions/${id}/logs`)
    expect(response.status).toBe(200)
    const records = (await response.json()) as Array<RequestLog & { seq: number }>
    expect(records.map((r) => r.path)).toEqual(['/users/9'])
  })

  test('GET /admin/sessions/{id}/logs returns one ordered timeline across services', async () => {
    // A request the live server records (service "users"), then a record from another
    // service ("orders") for the same session injected into the shared store — proving
    // a session spanning multiple services returns a single ordered cross-service timeline.
    const { id } = (await (await fetch(`${base}/admin/sessions`, { method: 'POST' })).json()) as {
      id: string
    }
    await (await fetch(`${base}/users/3`, { headers: { 'x-mock-session': id } })).text()
    server.requestLog.append({
      method: 'POST',
      path: '/orders',
      outcome: { type: 'matched', address: { route: 'orders', preset: 'default', variant: 'ok' } },
      status: 201,
      latencyMs: 0.5,
      session: id,
      service: 'orders',
    })

    const records = (await (await fetch(`${base}/admin/sessions/${id}/logs`)).json()) as Array<
      RequestLog & { seq: number; service: string }
    >
    expect(records.map((r) => `${r.service} ${r.path}`)).toEqual([
      'users /users/3',
      'orders /orders',
    ])
  })

  test('GET /admin/sessions/{id}/logs is an empty timeline for a session with no records', async () => {
    const response = await fetch(`${base}/admin/sessions/never-existed/logs`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([])
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
