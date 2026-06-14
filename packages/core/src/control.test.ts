import { describe, expect, test } from '@rstest/core'
import { createController } from './control'
import type { Collection, Definitions, RequestEnvelope, Route } from './types'

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

const happyPath: Collection = { id: 'happy-path', routes: ['users-list-api:default:success'] }
const errorState: Collection = { id: 'error-state', routes: ['users-list-api:default:error'] }

function defs(): Definitions {
  return {
    routes: new Map([[usersRoute.id, usersRoute]]),
    collections: new Map([
      [happyPath.id, happyPath],
      [errorState.id, errorState],
    ]),
  }
}

const get = envelope({ method: 'GET', path: '/users/42' })

describe('createController', () => {
  test('matches against the default collection out of the box', () => {
    const control = createController(defs(), 'happy-path')
    const result = control.match(get)
    expect(result.type).toBe('matched')
    if (result.type !== 'matched') return
    expect(result.response.status).toBe(200)
  })

  test('setCollection changes the active collection; the next match reflects it atomically', () => {
    const control = createController(defs(), 'happy-path')
    control.setCollection('error-state')
    const result = control.match(get)
    expect(result.type).toBe('matched')
    if (result.type !== 'matched') return
    expect(result.response.status).toBe(500)
  })

  test('useRoute overrides a single route within the active collection', () => {
    const control = createController(defs(), 'happy-path')
    control.useRoute('users-list-api', 'default', 'error')
    const result = control.match(get)
    expect(result.type).toBe('matched')
    if (result.type !== 'matched') return
    expect(result.response.status).toBe(500)
  })

  test('reset returns to the active collection baseline, dropping overrides', () => {
    const control = createController(defs(), 'happy-path')
    control.useRoute('users-list-api', 'default', 'error')
    control.reset()
    const result = control.match(get)
    expect(result.type).toBe('matched')
    if (result.type !== 'matched') return
    expect(result.response.status).toBe(200)
  })

  test('reset keeps the active collection, not the default one', () => {
    const control = createController(defs(), 'happy-path')
    control.setCollection('error-state')
    control.useRoute('users-list-api', 'default', 'success')
    control.reset()
    const result = control.match(get)
    expect(result.type).toBe('matched')
    if (result.type !== 'matched') return
    expect(result.response.status).toBe(500)
  })

  test('the latest useRoute for a slot wins', () => {
    const control = createController(defs(), 'happy-path')
    control.useRoute('users-list-api', 'default', 'error')
    control.useRoute('users-list-api', 'default', 'success')
    const result = control.match(get)
    expect(result.type).toBe('matched')
    if (result.type !== 'matched') return
    expect(result.response.status).toBe(200)
  })

  test('selection exposes a read-only snapshot of the mutable state', () => {
    const control = createController(defs(), 'happy-path')
    control.useRoute('users-list-api', 'default', 'error')
    expect(control.selection).toEqual({
      collection: 'happy-path',
      overrides: [{ route: 'users-list-api', preset: 'default', variant: 'error' }],
    })
  })

  test('setCollection on an undefined collection throws and leaves state unchanged', () => {
    const control = createController(defs(), 'happy-path')
    expect(() => control.setCollection('ghost')).toThrow(/not defined/)
    expect(control.match(get).type).toBe('matched')
    expect(control.selection.collection).toBe('happy-path')
  })

  test('useRoute validates the route, preset, and variant exist', () => {
    const control = createController(defs(), 'happy-path')
    expect(() => control.useRoute('ghost', 'default', 'success')).toThrow(/route "ghost"/)
    expect(() => control.useRoute('users-list-api', 'ghost', 'success')).toThrow(/preset "ghost"/)
    expect(() => control.useRoute('users-list-api', 'default', 'ghost')).toThrow(/variant "ghost"/)
  })

  test('an undefined default collection throws at creation', () => {
    expect(() => createController(defs(), 'ghost')).toThrow(/not defined/)
  })
})
