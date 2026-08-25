import {
  type Collection,
  createController,
  createEngine,
  type Definitions,
  planResponse,
  type RequestEnvelope,
  type Route,
  resolveCollection,
  type Selection,
} from '@decoy/core'
import { describe, expect, test } from '@rstest/core'
import { createServer } from './server'
import { createSessionRegistry } from './sessions'

function envelope(
  partial: Partial<RequestEnvelope> & Pick<RequestEnvelope, 'method' | 'path'>,
): RequestEnvelope {
  return {
    params: {},
    query: {},
    headers: {},
    cookies: {},
    body: undefined,
    ...partial,
    method: partial.method,
    url: partial.url ?? partial.path,
    path: partial.path,
  }
}

const users: Route = {
  id: 'users',
  method: 'GET',
  path: '/users/{id}',
  presets: {
    default: {},
    ada: { params: { id: '42' } },
    admin: { headers: { 'x-role': 'admin' } },
  },
  variants: {
    ok: { status: 200, body: { source: 'default', id: '${ params.id }' } },
    ada: {
      status: 200,
      headers: { 'x-decoy-case': 'ada' },
      body: { source: 'case', id: '${ params.id }' },
    },
    admin: { status: 202, body: { source: 'admin' } },
    error: { status: 500, body: { error: 'boom' } },
  },
}

const search: Route = {
  id: 'search',
  method: 'GET',
  path: '/search',
  presets: { q: { query: { q: 'ada' } } },
  variants: { ok: { status: 200, body: { ok: true } } },
}

const base: Collection = {
  id: 'base',
  routes: ['users:default:ok', 'search:q:ok'],
}

const inherited: Collection = {
  id: 'inherited',
  from: 'base',
  routes: ['users:default:error', 'users:ada:ada'],
}

const definitions: Definitions = {
  routes: new Map([
    [users.id, users],
    [search.id, search],
  ]),
  collections: new Map([
    [base.id, base],
    [inherited.id, inherited],
  ]),
}

const selection: Selection = { collection: 'inherited' }

const silent = {
  info() {},
  warn() {},
  error() {},
  request() {},
}

describe('golden semantic contract', () => {
  test('route/case/behavior selection returns the selected address and rendered response plan', () => {
    const result = createEngine(definitions).match(
      envelope({ method: 'GET', path: '/users/42' }),
      selection,
    )

    expect(result.type).toBe('matched')
    if (result.type !== 'matched') return
    expect(result.address).toEqual({ route: 'users', preset: 'ada', variant: 'ada' })
    expect(planResponse(result, 501)).toEqual({
      status: 200,
      headers: { 'x-decoy-case': 'ada', 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'case', id: '42' }),
    })
  })

  test('collection from inheritance appends child activations after parent activations', () => {
    expect(resolveCollection(definitions, 'inherited')).toEqual([
      { route: 'users', preset: 'default', variant: 'ok' },
      { route: 'search', preset: 'q', variant: 'ok' },
      { route: 'users', preset: 'default', variant: 'error' },
      { route: 'users', preset: 'ada', variant: 'ada' },
    ])
  })

  test('bottom-to-top matching order lets the last matching selected case win', () => {
    const engine = createEngine({
      routes: new Map([[users.id, users]]),
      collections: new Map([
        ['order', { id: 'order', routes: ['users:default:ok', 'users:ada:ada'] }],
      ]),
    })

    const result = engine.match(envelope({ method: 'GET', path: '/users/42' }), {
      collection: 'order',
    })

    expect(result.type).toBe('matched')
    if (result.type !== 'matched') return
    expect(result.address).toEqual({ route: 'users', preset: 'ada', variant: 'ada' })
  })

  test('passthrough plan resolution reports explicit passthrough instead of a fail-closed response', async () => {
    const server = createServer(
      {
        name: 'contract',
        port: 0,
        defaultCollection: 'base',
        missStatus: 501,
        passthrough: { url: 'https://upstream.example.test' },
        sessionIdleTtlMs: 60_000,
        definitions,
        control: { enabled: true, prefix: '/__decoy__' },
      },
      { logger: silent },
    )
    const port = await server.listen()
    try {
      const response = await fetch(`http://localhost:${port}/__decoy__/try`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ method: 'GET', path: '/unmatched' }),
      })

      expect(await response.json()).toEqual({
        resolution: 'PASSTHROUGH(https://upstream.example.test)',
        response: null,
      })
    } finally {
      await server.close()
    }
  })

  test('fail-closed miss shape is stable when passthrough is not selected', () => {
    const result = createEngine(definitions).match(
      envelope({ method: 'GET', path: '/unmatched' }),
      selection,
    )

    expect(result.type).toBe('miss')
    if (result.type !== 'miss') return
    expect(planResponse(result, 501)).toEqual({
      status: 501,
      headers: { 'x-mock-miss': 'true', 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'no route matched GET /unmatched' }),
    })
  })

  test('per-session isolation keeps collection switches and route overrides scoped', () => {
    const registry = createSessionRegistry(definitions, 'base', { reapIntervalMs: 0 })
    try {
      registry.resolve('a').useCollection('inherited')
      registry.resolve('b').useRoute('users', 'default', 'error')

      expect(registry.resolve('a').selection).toEqual({ collection: 'inherited', overrides: [] })
      expect(registry.resolve('b').selection).toEqual({
        collection: 'base',
        overrides: [{ route: 'users', preset: 'default', variant: 'error' }],
      })
      expect(registry.resolve(undefined).selection).toEqual({ collection: 'base', overrides: [] })
    } finally {
      registry.stop()
    }
  })

  test('control verbs useCollection, useRoute, and reset define the mutable selection contract', () => {
    const control = createController(definitions, 'base')

    control.useCollection('inherited')
    expect(control.selection).toEqual({ collection: 'inherited', overrides: [] })

    control.useRoute('users', 'default', 'ok')
    expect(control.selection).toEqual({
      collection: 'inherited',
      overrides: [{ route: 'users', preset: 'default', variant: 'ok' }],
    })

    control.reset()
    expect(control.selection).toEqual({ collection: 'inherited', overrides: [] })
  })
})
