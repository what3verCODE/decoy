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

describe('createEngine().match — literal preset matching', () => {
  const route: Route = {
    id: 'users',
    method: 'GET',
    path: '/users',
    presets: {
      'with-query': { query: { page: '2' } },
      'with-headers': { headers: { 'x-tenant': 'acme' } },
      'with-body': { body: { filter: { active: true } } },
      default: {},
    },
    variants: {
      q: { status: 200, body: { matched: 'query' } },
      h: { status: 200, body: { matched: 'headers' } },
      b: { status: 200, body: { matched: 'body' } },
      d: { status: 200, body: { matched: 'default' } },
    },
  }
  const collection: Collection = {
    id: 'c',
    routes: ['users:with-query:q', 'users:with-headers:h', 'users:with-body:b', 'users:default:d'],
  }
  // a collection with no catch-all preset active — used to exercise the no-preset miss
  const qonly: Collection = { id: 'qonly', routes: ['users:with-query:q'] }
  const noCatchAll: Collection = {
    id: 'noCatchAll',
    routes: ['users:with-query:q', 'users:with-headers:h', 'users:with-body:b'],
  }
  const sel: Selection = { collection: 'c' }
  const engine = createEngine(definitions([route], [collection, qonly, noCatchAll]))

  function matched(req: Partial<RequestEnvelope> & Pick<RequestEnvelope, 'method' | 'path'>) {
    const result = engine.match(envelope(req), sel)
    expect(result.type).toBe('matched')
    if (result.type !== 'matched') throw new Error('expected match')
    return result
  }

  test('query preset matches as a subset — extras ignored', () => {
    const result = matched({ method: 'GET', path: '/users', query: { page: '2', sort: 'asc' } })
    expect(result.address.preset).toBe('with-query')
  })

  test('a query value mismatch falls through to the catch-all', () => {
    const result = matched({ method: 'GET', path: '/users', query: { page: '1' } })
    expect(result.address.preset).toBe('default')
  })

  test('a query preset matches when the request repeats the key (array value)', () => {
    const result = matched({ method: 'GET', path: '/users', query: { page: ['1', '2'] } })
    expect(result.address.preset).toBe('with-query')
  })

  test('header preset matches case-insensitively on the name', () => {
    const result = matched({ method: 'GET', path: '/users', headers: { 'X-Tenant': 'acme' } })
    expect(result.address.preset).toBe('with-headers')
  })

  test('a header value mismatch falls through to the catch-all', () => {
    const result = matched({ method: 'GET', path: '/users', headers: { 'x-tenant': 'globex' } })
    expect(result.address.preset).toBe('default')
  })

  test('body preset matches deep-partial — nested + sibling keys ignored', () => {
    const result = matched({
      method: 'GET',
      path: '/users',
      body: { filter: { active: true, q: 'ada' }, page: 3 },
    })
    expect(result.address.preset).toBe('with-body')
  })

  test('a nested body value mismatch falls through to the catch-all', () => {
    const result = matched({
      method: 'GET',
      path: '/users',
      body: { filter: { active: false } },
    })
    expect(result.address.preset).toBe('default')
  })

  test('the catch-all preset matches when no conditions apply', () => {
    const result = matched({ method: 'GET', path: '/users' })
    expect(result.address.preset).toBe('default')
  })

  test('first matching preset wins in collection-array order', () => {
    // satisfies both with-query and with-headers; with-query is listed first
    const result = matched({
      method: 'GET',
      path: '/users',
      query: { page: '2' },
      headers: { 'x-tenant': 'acme' },
    })
    expect(result.address.preset).toBe('with-query')
  })

  test('body deep-partial matches array elements by index, ignoring extras', () => {
    const arrRoute: Route = {
      id: 'orders',
      method: 'POST',
      path: '/orders',
      presets: { 'first-active': { body: { items: [{ status: 'active' }] } }, default: {} },
      variants: { ok: { status: 200, body: { ok: true } }, d: { status: 200, body: {} } },
    }
    const arrCol: Collection = {
      id: 'a',
      routes: ['orders:first-active:ok', 'orders:default:d'],
    }
    const arrEngine = createEngine(definitions([arrRoute], [arrCol]))
    const hit = arrEngine.match(
      envelope({
        method: 'POST',
        path: '/orders',
        body: { items: [{ status: 'active', id: 1 }, { status: 'archived' }] },
      }),
      { collection: 'a' },
    )
    expect(hit.type).toBe('matched')
    if (hit.type !== 'matched') return
    expect(hit.address.preset).toBe('first-active')

    const miss = arrEngine.match(
      envelope({ method: 'POST', path: '/orders', body: { items: [{ status: 'archived' }] } }),
      { collection: 'a' },
    )
    expect(miss.type).toBe('matched')
    if (miss.type !== 'matched') return
    expect(miss.address.preset).toBe('default')
  })

  test('route matched but no active preset matched is a distinct no-preset miss', () => {
    // request carries no query → the only active preset (with-query) fails
    const result = engine.match(envelope({ method: 'GET', path: '/users' }), {
      collection: 'qonly',
    })
    expect(result.type).toBe('miss')
    if (result.type !== 'miss') return
    expect(result.reason).toEqual({
      kind: 'no-preset',
      method: 'GET',
      path: '/users',
      tried: [{ route: 'users', preset: 'with-query' }],
    })
    expect(result.message).toContain('users')
    expect(result.message).toContain('with-query')
  })

  test('the no-preset diagnostic lists every active preset tried, in array order', () => {
    const result = engine.match(envelope({ method: 'GET', path: '/users', query: { page: '9' } }), {
      collection: 'noCatchAll',
    })
    expect(result.type).toBe('miss')
    if (result.type !== 'miss') return
    if (result.reason.kind !== 'no-preset') throw new Error('expected no-preset miss')
    expect(result.reason.tried).toEqual([
      { route: 'users', preset: 'with-query' },
      { route: 'users', preset: 'with-headers' },
      { route: 'users', preset: 'with-body' },
    ])
    expect(result.message).toContain('with-query')
    expect(result.message).toContain('with-headers')
    expect(result.message).toContain('with-body')
  })

  test('no-preset wins over no-route when the method+path matched', () => {
    // /users matches by method+path; only no-query preset is active and it fails
    const noMatch = engine.match(envelope({ method: 'GET', path: '/users' }), {
      collection: 'qonly',
    })
    expect(noMatch.type).toBe('miss')
    if (noMatch.type !== 'miss') return
    expect(noMatch.reason.kind).toBe('no-preset')

    // a path no route matches at all stays a no-route miss
    const noRoute = engine.match(envelope({ method: 'GET', path: '/ghost' }), {
      collection: 'qonly',
    })
    expect(noRoute.type).toBe('miss')
    if (noRoute.type !== 'miss') return
    expect(noRoute.reason.kind).toBe('no-route')
  })
})

describe('createEngine().match — ${ } string predicates', () => {
  // a "heavy" condition: serve only when the body carries ≥1 active item
  const orders: Route = {
    id: 'orders',
    method: 'POST',
    path: '/orders',
    presets: {
      'has-active': { body: "${ length(body.items[?status=='active']) > `0` }" },
      default: {},
    },
    variants: {
      active: { status: 200, body: { matched: 'has-active' } },
      d: { status: 200, body: { matched: 'default' } },
    },
  }
  const collection: Collection = {
    id: 'c',
    routes: ['orders:has-active:active', 'orders:default:d'],
  }
  const engine = createEngine(definitions([orders], [collection]))
  const sel: Selection = { collection: 'c' }

  test('a truthy predicate serves the variant', () => {
    const result = engine.match(
      envelope({
        method: 'POST',
        path: '/orders',
        body: { items: [{ status: 'archived' }, { status: 'active' }] },
      }),
      sel,
    )
    expect(result.type).toBe('matched')
    if (result.type !== 'matched') return
    expect(result.address.preset).toBe('has-active')
  })

  test('a falsy predicate falls through to the catch-all', () => {
    const result = engine.match(
      envelope({ method: 'POST', path: '/orders', body: { items: [{ status: 'archived' }] } }),
      sel,
    )
    expect(result.type).toBe('matched')
    if (result.type !== 'matched') return
    expect(result.address.preset).toBe('default')
  })

  test('a string predicate is ANDed with a literal pattern — both must hold', () => {
    const route: Route = {
      id: 'search',
      method: 'GET',
      path: '/search',
      presets: {
        // a literal query pattern AND a ${ } predicate over the body
        both: { query: { tenant: 'acme' }, body: '${ length(body.terms) > `1` }' },
        default: {},
      },
      variants: { ok: { status: 200, body: { matched: 'both' } }, d: { status: 200, body: {} } },
    }
    const col: Collection = { id: 's', routes: ['search:both:ok', 'search:default:d'] }
    const e = createEngine(definitions([route], [col]))

    // both literal + predicate satisfied
    const hit = e.match(
      envelope({
        method: 'GET',
        path: '/search',
        query: { tenant: 'acme' },
        body: { terms: ['a', 'b'] },
      }),
      { collection: 's' },
    )
    expect(hit.type === 'matched' && hit.address.preset).toBe('both')

    // predicate holds but the literal query does not → falls through
    const queryFails = e.match(
      envelope({
        method: 'GET',
        path: '/search',
        query: { tenant: 'globex' },
        body: { terms: ['a', 'b'] },
      }),
      { collection: 's' },
    )
    expect(queryFails.type === 'matched' && queryFails.address.preset).toBe('default')

    // literal query holds but the predicate does not → falls through
    const predicateFails = e.match(
      envelope({
        method: 'GET',
        path: '/search',
        query: { tenant: 'acme' },
        body: { terms: ['a'] },
      }),
      { collection: 's' },
    )
    expect(predicateFails.type === 'matched' && predicateFails.address.preset).toBe('default')
  })

  test('GraphQL works through a ${ } predicate — operationName selects the variant', () => {
    const gql: Route = {
      id: 'graphql',
      method: 'POST',
      path: '/graphql',
      presets: {
        'get-user': { body: "${ body.operationName == 'GetUser' }" },
        'list-orders': { body: "${ body.operationName == 'ListOrders' }" },
      },
      variants: {
        user: { status: 200, body: { data: { user: { id: 1 } } } },
        orders: { status: 200, body: { data: { orders: [] } } },
      },
    }
    const col: Collection = {
      id: 'g',
      routes: ['graphql:get-user:user', 'graphql:list-orders:orders'],
    }
    const e = createEngine(definitions([gql], [col]))

    const user = e.match(
      envelope({ method: 'POST', path: '/graphql', body: { operationName: 'GetUser' } }),
      { collection: 'g' },
    )
    expect(user.type).toBe('matched')
    if (user.type !== 'matched') return
    expect(user.address.variant).toBe('user')

    const orders2 = e.match(
      envelope({ method: 'POST', path: '/graphql', body: { operationName: 'ListOrders' } }),
      { collection: 'g' },
    )
    expect(orders2.type).toBe('matched')
    if (orders2.type !== 'matched') return
    expect(orders2.address.variant).toBe('orders')

    // an unknown operation matches neither predicate → no-preset miss
    const unknown = e.match(
      envelope({ method: 'POST', path: '/graphql', body: { operationName: 'DeleteUser' } }),
      { collection: 'g' },
    )
    expect(unknown.type).toBe('miss')
    if (unknown.type !== 'miss') return
    expect(unknown.reason.kind).toBe('no-preset')
  })

  test('predicate truthiness follows JMESPath — a present, non-empty path is truthy', () => {
    const route: Route = {
      id: 'flagged',
      method: 'GET',
      path: '/flagged',
      // a bare path predicate: truthy when body.flag is present and non-empty
      presets: { 'has-flag': { body: '${ body.flag }' }, default: {} },
      variants: { y: { status: 200, body: { matched: 'has-flag' } }, d: { status: 200, body: {} } },
    }
    const col: Collection = { id: 'f', routes: ['flagged:has-flag:y', 'flagged:default:d'] }
    const e = createEngine(definitions([route], [col]))

    const present = e.match(envelope({ method: 'GET', path: '/flagged', body: { flag: 'on' } }), {
      collection: 'f',
    })
    expect(present.type === 'matched' && present.address.preset).toBe('has-flag')

    // absent → null → falsy → falls through
    const absent = e.match(envelope({ method: 'GET', path: '/flagged', body: {} }), {
      collection: 'f',
    })
    expect(absent.type === 'matched' && absent.address.preset).toBe('default')

    // present but empty string → falsy (JMESPath truthiness) → falls through
    const empty = e.match(envelope({ method: 'GET', path: '/flagged', body: { flag: '' } }), {
      collection: 'f',
    })
    expect(empty.type === 'matched' && empty.address.preset).toBe('default')
  })

  test('a failing predicate on the only active preset is a no-preset miss', () => {
    // a collection activating only the predicate preset — no catch-all to fall through to
    const predicateOnly: Collection = { id: 'p', routes: ['orders:has-active:active'] }
    const e = createEngine(definitions([orders], [collection, predicateOnly]))
    const result = e.match(envelope({ method: 'POST', path: '/orders', body: { items: [] } }), {
      collection: 'p',
    })
    expect(result.type).toBe('miss')
    if (result.type !== 'miss') return
    expect(result.reason).toEqual({
      kind: 'no-preset',
      method: 'POST',
      path: '/orders',
      tried: [{ route: 'orders', preset: 'has-active' }],
    })
  })

  test('an invalid ${ } predicate throws at engine creation', () => {
    const bad: Route = {
      id: 'bad',
      method: 'GET',
      path: '/bad',
      presets: { broken: { body: '${ length( }' } },
      variants: { ok: { status: 200, body: {} } },
    }
    const col: Collection = { id: 'b', routes: ['bad:broken:ok'] }
    expect(() => createEngine(definitions([bad], [col]))).toThrow(/preset "broken"/)
  })

  test('an invalid ${ } variant template throws at engine creation', () => {
    const bad: Route = {
      id: 'bad',
      method: 'GET',
      path: '/bad',
      presets: { default: {} },
      variants: { ok: { status: 200, body: { x: '${ length( }' } } },
    }
    const col: Collection = { id: 'b', routes: ['bad:default:ok'] }
    expect(() => createEngine(definitions([bad], [col]))).toThrow(/variant "ok"/)
  })
})

describe('createEngine().match — ${ } response templating', () => {
  const route: Route = {
    id: 'users',
    method: 'GET',
    path: '/users/{id}',
    presets: { default: {} },
    variants: {
      tpl: {
        status: '${ body.code }',
        headers: { 'x-count': '${ length(body.items) }' },
        body: {
          id: '${ pathParams.id }',
          count: '${ length(body.items) }',
          greeting: 'Hi ${ body.name }!',
          label: 'static',
        },
      },
    },
  }
  const collection: Collection = { id: 'c', routes: ['users:default:tpl'] }
  const engine = createEngine(definitions([route], [collection]))

  test('renders typed leaves, interpolates embedded text, and coerces templated status', () => {
    const result = engine.match(
      envelope({
        method: 'GET',
        path: '/users/42',
        body: { code: 201, items: [1, 2, 3], name: 'Ada' },
      }),
      { collection: 'c' },
    )
    expect(result.type).toBe('matched')
    if (result.type !== 'matched') return
    expect(result.response.status).toBe(201)
    expect(result.response.headers['x-count']).toBe('3')
    expect(result.response.body).toEqual({
      id: '42',
      count: 3,
      greeting: 'Hi Ada!',
      label: 'static',
    })
  })

  test('a missing path renders as null in a whole-string leaf', () => {
    const result = engine.match(
      envelope({ method: 'GET', path: '/users/7', body: { code: 200, items: [] } }),
      { collection: 'c' },
    )
    expect(result.type).toBe('matched')
    if (result.type !== 'matched') return
    expect((result.response.body as { greeting: unknown }).greeting).toBe('Hi !')
    expect((result.response.body as { count: unknown }).count).toBe(0)
  })
})
