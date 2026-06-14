import { createServer as createHttpServer, type Server } from 'node:http'
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
    missStatus: 501,
    sessionIdleTtlMs: 1_800_000,
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

  test('miss status is configurable (default 501)', async () => {
    const custom = createServer({ ...service(), missStatus: 503 }, { logger: silent })
    const port = await custom.listen()
    try {
      const response = await fetch(`http://localhost:${port}/orders`)
      expect(response.status).toBe(503)
      expect(response.headers.get('x-mock-miss')).toBe('true')
      expect(await response.json()).toEqual({ error: 'no route matched GET /orders' })
    } finally {
      await custom.close()
    }
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

describe('createServer (passthrough)', () => {
  let upstream: Server
  let upstreamUrl: string
  let received: Array<{
    method: string
    url: string
    headers: Record<string, string>
    body: string
  }>

  beforeEach(async () => {
    received = []
    upstream = createHttpServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (c) => chunks.push(c as Buffer))
      req.on('end', () => {
        received.push({
          method: req.method ?? '',
          url: req.url ?? '',
          headers: req.headers as Record<string, string>,
          body: Buffer.concat(chunks).toString('utf8'),
        })
        res.statusCode = 200
        res.setHeader('content-type', 'application/json')
        res.setHeader('x-from-upstream', 'yes')
        res.end(JSON.stringify({ real: true, path: req.url }))
      })
    })
    upstreamUrl = await new Promise<string>((resolvePort) => {
      upstream.listen(0, () => {
        const address = upstream.address()
        resolvePort(`http://localhost:${typeof address === 'object' && address ? address.port : 0}`)
      })
    })
  })

  afterEach(async () => {
    await new Promise<void>((done) => upstream.close(() => done()))
  })

  test('forwards an unmatched request verbatim to the upstream and returns its response', async () => {
    const lines: string[] = []
    const logger: Logger = { info: (m) => lines.push(m), warn: (m) => lines.push(m) }
    const server = createServer({ ...service(), passthrough: { url: upstreamUrl } }, { logger })
    const port = await server.listen()
    try {
      const response = await fetch(`http://localhost:${port}/orders?page=2`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ item: 'x' }),
      })

      expect(response.status).toBe(200)
      expect(response.headers.get('x-mock-miss')).toBeNull()
      expect(response.headers.get('x-from-upstream')).toBe('yes')
      expect(await response.json()).toEqual({ real: true, path: '/orders?page=2' })

      expect(received).toHaveLength(1)
      expect(received[0]?.method).toBe('POST')
      expect(received[0]?.url).toBe('/orders?page=2')
      expect(received[0]?.body).toBe('{"item":"x"}')

      expect(lines.some((l) => l.includes(`PASSTHROUGH(${upstreamUrl})`))).toBe(true)
    } finally {
      await server.close()
    }
  })

  test('a matched route is served from the mock, never forwarded', async () => {
    const server = createServer(
      { ...service(), passthrough: { url: upstreamUrl } },
      { logger: silent },
    )
    const port = await server.listen()
    try {
      const response = await fetch(`http://localhost:${port}/users/42`)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ id: 42, name: 'Ada' })
      expect(received).toHaveLength(0)
    } finally {
      await server.close()
    }
  })

  test('with passthrough off (default), an unmatched request still fails closed', async () => {
    const server = createServer(service(), { logger: silent })
    const port = await server.listen()
    try {
      const response = await fetch(`http://localhost:${port}/orders`)
      expect(response.status).toBe(501)
      expect(response.headers.get('x-mock-miss')).toBe('true')
      expect(received).toHaveLength(0)
    } finally {
      await server.close()
    }
  })
})
