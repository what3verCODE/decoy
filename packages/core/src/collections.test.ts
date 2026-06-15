import { describe, expect, test } from '@rstest/core'
import { resolveCollection } from './collections'
import type { Collection, Definitions, Route } from './types'

const usersRoute: Route = {
  id: 'users-list-api',
  method: 'GET',
  path: '/users/{id}',
  presets: { default: {} },
  variants: {
    success: { status: 200, body: { id: 42 } },
    error: { status: 500, body: { error: 'boom' } },
  },
}
const ordersRoute: Route = {
  id: 'orders-api',
  method: 'GET',
  path: '/orders',
  presets: { default: {} },
  variants: { success: { status: 200, body: [] } },
}

function definitions(collections: Collection[]): Definitions {
  return {
    routes: new Map([
      [usersRoute.id, usersRoute],
      [ordersRoute.id, ordersRoute],
    ]),
    collections: new Map(collections.map((c) => [c.id, c])),
  }
}

describe('resolveCollection', () => {
  test('returns the ordered variant-address entries of a flat collection', () => {
    const happyPath: Collection = {
      id: 'happy-path',
      routes: ['users-list-api:default:success', 'orders-api:default:success'],
    }
    expect(resolveCollection(definitions([happyPath]), 'happy-path')).toEqual([
      { route: 'users-list-api', preset: 'default', variant: 'success' },
      { route: 'orders-api', preset: 'default', variant: 'success' },
    ])
  })

  test('resolves extends — inherited entries first, child overrides in place, new slots appended', () => {
    const base: Collection = {
      id: 'base',
      routes: ['users-list-api:default:success'],
    }
    const child: Collection = {
      id: 'checkout-fails',
      extends: 'base',
      routes: ['users-list-api:default:error', 'orders-api:default:success'],
    }
    expect(resolveCollection(definitions([base, child]), 'checkout-fails')).toEqual([
      // overridden in place, keeping the parent's order position
      { route: 'users-list-api', preset: 'default', variant: 'error' },
      // new slot appended in child order
      { route: 'orders-api', preset: 'default', variant: 'success' },
    ])
  })

  test('an empty collection resolves to no entries', () => {
    expect(resolveCollection(definitions([{ id: 'empty', routes: [] }]), 'empty')).toEqual([])
  })

  test('throws when the collection is not defined', () => {
    expect(() => resolveCollection(definitions([]), 'ghost')).toThrow(/not defined/)
  })

  test('throws when an extended collection is not defined', () => {
    const child: Collection = { id: 'child', extends: 'ghost', routes: [] }
    expect(() => resolveCollection(definitions([child]), 'child')).toThrow(/not defined/)
  })

  test('throws on a cyclic extends chain', () => {
    const a: Collection = { id: 'a', extends: 'b', routes: [] }
    const b: Collection = { id: 'b', extends: 'a', routes: [] }
    expect(() => resolveCollection(definitions([a, b]), 'a')).toThrow(/cyclic/)
  })
})
