import { describe, expect, test } from '@rstest/core'
import { createEngine } from './engine'
import type { Collection, Definitions, RequestEnvelope, Route, Selection } from './types'

function envelope(
  partial: Partial<RequestEnvelope> & Pick<RequestEnvelope, 'method' | 'path'>,
): RequestEnvelope {
  return {
    url: partial.path,
    pathParams: {},
    query: {},
    headers: {},
    cookies: {},
    body: undefined,
    ...partial,
  }
}

function definitions(routes: Route[], collections: Collection[]): Definitions {
  return {
    routes: new Map(routes.map((r) => [r.id, r])),
    collections: new Map(collections.map((c) => [c.id, c])),
  }
}

const usersList: Route = {
  id: 'users-list-api',
  method: 'GET',
  path: '/users/{id}',
  presets: { default: {} },
  variants: { success: { status: 200, body: { id: 42, name: 'Ada' } } },
}

const happyPath: Collection = {
  id: 'happy-path',
  routes: ['users-list-api:default:success'],
}

const selection: Selection = { collection: 'happy-path' }

describe('createEngine().match', () => {
  test('serves a matched variant with path params', () => {
    const engine = createEngine(definitions([usersList], [happyPath]))
    const result = engine.match(envelope({ method: 'GET', path: '/users/42' }), selection)

    expect(result.type).toBe('matched')
    if (result.type !== 'matched') return
    expect(result.address).toEqual({
      route: 'users-list-api',
      preset: 'default',
      variant: 'success',
    })
    expect(result.pathParams).toEqual({ id: '42' })
    expect(result.response).toEqual({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: { id: 42, name: 'Ada' },
    })
  })

  test('method mismatch is a miss', () => {
    const engine = createEngine(definitions([usersList], [happyPath]))
    const result = engine.match(envelope({ method: 'POST', path: '/users/42' }), selection)
    expect(result.type).toBe('miss')
    if (result.type !== 'miss') return
    expect(result.reason).toEqual({ kind: 'no-route', method: 'POST', path: '/users/42' })
  })

  test('unknown path is a miss', () => {
    const engine = createEngine(definitions([usersList], [happyPath]))
    const result = engine.match(envelope({ method: 'GET', path: '/orders' }), selection)
    expect(result.type).toBe('miss')
  })

  test('unknown collection is a miss', () => {
    const engine = createEngine(definitions([usersList], [happyPath]))
    const result = engine.match(envelope({ method: 'GET', path: '/users/42' }), {
      collection: 'ghost',
    })
    expect(result.type).toBe('miss')
    if (result.type !== 'miss') return
    expect(result.reason).toEqual({ kind: 'no-collection', collection: 'ghost' })
  })

  test('walks the collection in array order — first match wins', () => {
    const me: Route = {
      id: 'users-me',
      method: 'GET',
      path: '/users/me',
      presets: { default: {} },
      variants: { success: { status: 200, body: { id: 'me' } } },
    }
    const byId: Route = {
      id: 'users-by-id',
      method: 'GET',
      path: '/users/{id}',
      presets: { default: {} },
      variants: { success: { status: 200, body: { id: 'other' } } },
    }
    const collection: Collection = {
      id: 'c',
      routes: ['users-me:default:success', 'users-by-id:default:success'],
    }
    const engine = createEngine(definitions([me, byId], [collection]))
    const result = engine.match(envelope({ method: 'GET', path: '/users/me' }), { collection: 'c' })

    expect(result.type).toBe('matched')
    if (result.type !== 'matched') return
    expect(result.address.route).toBe('users-me')
    expect(result.response.body).toEqual({ id: 'me' })
  })

  test('a route not activated in the collection is a miss', () => {
    const engine = createEngine(definitions([usersList], [{ id: 'empty', routes: [] }]))
    const result = engine.match(envelope({ method: 'GET', path: '/users/42' }), {
      collection: 'empty',
    })
    expect(result.type).toBe('miss')
  })
})

describe('createEngine().match — collection extends', () => {
  const route: Route = {
    id: 'users-list-api',
    method: 'GET',
    path: '/users/{id}',
    presets: { default: {} },
    variants: {
      success: { status: 200, body: { id: 42 } },
      error: { status: 500, body: { error: 'boom' } },
    },
  }
  const orders: Route = {
    id: 'orders-api',
    method: 'GET',
    path: '/orders',
    presets: { default: {} },
    variants: { success: { status: 200, body: [{ id: 1 }] } },
  }

  test('a child collection inherits its parent entries', () => {
    const base: Collection = { id: 'base', routes: ['users-list-api:default:success'] }
    const child: Collection = {
      id: 'child',
      extends: 'base',
      routes: ['orders-api:default:success'],
    }
    const engine = createEngine(definitions([route, orders], [base, child]))

    const inherited = engine.match(envelope({ method: 'GET', path: '/users/42' }), {
      collection: 'child',
    })
    expect(inherited.type).toBe('matched')
    if (inherited.type !== 'matched') return
    expect(inherited.response.body).toEqual({ id: 42 })

    const own = engine.match(envelope({ method: 'GET', path: '/orders' }), { collection: 'child' })
    expect(own.type).toBe('matched')
  })

  test('a child overrides an inherited entry on the same route:preset slot', () => {
    const base: Collection = { id: 'base', routes: ['users-list-api:default:success'] }
    const child: Collection = {
      id: 'child',
      extends: 'base',
      routes: ['users-list-api:default:error'],
    }
    const engine = createEngine(definitions([route], [base, child]))

    const result = engine.match(envelope({ method: 'GET', path: '/users/42' }), {
      collection: 'child',
    })
    expect(result.type).toBe('matched')
    if (result.type !== 'matched') return
    expect(result.response.status).toBe(500)
    expect(result.address.variant).toBe('error')
  })

  test('extends chains resolve transitively', () => {
    const a: Collection = { id: 'a', routes: ['users-list-api:default:success'] }
    const b: Collection = { id: 'b', extends: 'a', routes: ['orders-api:default:success'] }
    const c: Collection = { id: 'c', extends: 'b', routes: ['users-list-api:default:error'] }
    const engine = createEngine(definitions([route, orders], [a, b, c]))

    const users = engine.match(envelope({ method: 'GET', path: '/users/42' }), { collection: 'c' })
    expect(users.type).toBe('matched')
    if (users.type !== 'matched') return
    expect(users.response.status).toBe(500)

    const ordersResult = engine.match(envelope({ method: 'GET', path: '/orders' }), {
      collection: 'c',
    })
    expect(ordersResult.type).toBe('matched')
  })

  test('a cyclic extends chain throws at engine creation', () => {
    const a: Collection = { id: 'a', extends: 'b', routes: [] }
    const b: Collection = { id: 'b', extends: 'a', routes: [] }
    expect(() => createEngine(definitions([route], [a, b]))).toThrow(/cyclic/)
  })

  test('extending an undefined collection throws at engine creation', () => {
    const child: Collection = { id: 'child', extends: 'ghost', routes: [] }
    expect(() => createEngine(definitions([route], [child]))).toThrow(/not defined/)
  })
})

describe('createEngine().match — per-route overrides', () => {
  const route: Route = {
    id: 'users-list-api',
    method: 'GET',
    path: '/users/{id}',
    presets: { default: {} },
    variants: {
      success: { status: 200, body: { id: 42 } },
      error: { status: 500, body: { error: 'boom' } },
    },
  }
  const orders: Route = {
    id: 'orders-api',
    method: 'GET',
    path: '/orders',
    presets: { default: {} },
    variants: { success: { status: 200, body: [{ id: 1 }] } },
  }
  const happy: Collection = { id: 'happy', routes: ['users-list-api:default:success'] }

  test('an override swaps the variant served for an active slot', () => {
    const engine = createEngine(definitions([route], [happy]))
    const result = engine.match(envelope({ method: 'GET', path: '/users/42' }), {
      collection: 'happy',
      overrides: [{ route: 'users-list-api', preset: 'default', variant: 'error' }],
    })
    expect(result.type).toBe('matched')
    if (result.type !== 'matched') return
    expect(result.response.status).toBe(500)
    expect(result.address.variant).toBe('error')
  })

  test('an override activates a slot the collection does not include', () => {
    const engine = createEngine(definitions([route, orders], [happy]))
    const result = engine.match(envelope({ method: 'GET', path: '/orders' }), {
      collection: 'happy',
      overrides: [{ route: 'orders-api', preset: 'default', variant: 'success' }],
    })
    expect(result.type).toBe('matched')
    if (result.type !== 'matched') return
    expect(result.address.route).toBe('orders-api')
  })

  test('no overrides leaves the collection baseline untouched', () => {
    const engine = createEngine(definitions([route], [happy]))
    const result = engine.match(envelope({ method: 'GET', path: '/users/42' }), {
      collection: 'happy',
      overrides: [],
    })
    expect(result.type).toBe('matched')
    if (result.type !== 'matched') return
    expect(result.response.status).toBe(200)
  })
})
