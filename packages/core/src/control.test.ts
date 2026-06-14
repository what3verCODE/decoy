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

describe('createController.reload', () => {
  /** Definitions where the success variant now returns 201 instead of 200. */
  function changedDefs(): Definitions {
    const route: Route = {
      ...usersRoute,
      variants: {
        success: { status: 201, body: { id: 42 } },
        error: { status: 500, body: { error: 'boom' } },
      },
    }
    return {
      routes: new Map([[route.id, route]]),
      collections: new Map([
        [happyPath.id, happyPath],
        [errorState.id, errorState],
      ]),
    }
  }

  test('the next match reflects the swapped definitions', () => {
    const control = createController(defs(), 'happy-path')
    expect((control.match(get) as { response: { status: number } }).response.status).toBe(200)

    control.reload(changedDefs(), 'happy-path')

    expect((control.match(get) as { response: { status: number } }).response.status).toBe(201)
  })

  test('preserves the active collection by name across a reload', () => {
    const control = createController(defs(), 'happy-path')
    control.setCollection('error-state')

    const result = control.reload(changedDefs(), 'happy-path')

    expect(result.collectionFellBack).toBe(false)
    expect(control.selection.collection).toBe('error-state')
    expect((control.match(get) as { response: { status: number } }).response.status).toBe(500)
  })

  test('preserves overrides that still resolve against the new definitions', () => {
    const control = createController(defs(), 'happy-path')
    control.useRoute('users-list-api', 'default', 'error')

    const result = control.reload(changedDefs(), 'happy-path')

    expect(result.droppedOverrides).toEqual([])
    expect(control.selection.overrides).toEqual([
      { route: 'users-list-api', preset: 'default', variant: 'error' },
    ])
    expect((control.match(get) as { response: { status: number } }).response.status).toBe(500)
  })

  test('falls back to the default collection when the active one vanished', () => {
    const control = createController(defs(), 'happy-path')
    control.setCollection('error-state')

    // New definitions drop error-state entirely.
    const next: Definitions = {
      routes: new Map([[usersRoute.id, usersRoute]]),
      collections: new Map([[happyPath.id, happyPath]]),
    }
    const result = control.reload(next, 'happy-path')

    expect(result.collectionFellBack).toBe(true)
    expect(result.collection).toBe('happy-path')
    expect(control.selection.collection).toBe('happy-path')
  })

  test('drops overrides whose route:preset:variant no longer resolves', () => {
    const control = createController(defs(), 'happy-path')
    control.useRoute('users-list-api', 'default', 'error')

    // New definitions keep the route but drop the error variant.
    const route: Route = {
      ...usersRoute,
      variants: { success: { status: 200, body: { id: 42 } } },
    }
    const next: Definitions = {
      routes: new Map([[route.id, route]]),
      collections: new Map([[happyPath.id, happyPath]]),
    }
    const result = control.reload(next, 'happy-path')

    expect(result.droppedOverrides).toEqual([
      { route: 'users-list-api', preset: 'default', variant: 'error' },
    ])
    expect(control.selection.overrides).toEqual([])
  })

  test('useRoute validates against the reloaded definitions', () => {
    const control = createController(defs(), 'happy-path')
    const route: Route = {
      ...usersRoute,
      variants: { success: { status: 200, body: { id: 42 } } },
    }
    control.reload(
      { routes: new Map([[route.id, route]]), collections: new Map([[happyPath.id, happyPath]]) },
      'happy-path',
    )
    // The error variant is gone after reload.
    expect(() => control.useRoute('users-list-api', 'default', 'error')).toThrow(/variant "error"/)
  })

  test('throws when the new default collection is not defined', () => {
    const control = createController(defs(), 'happy-path')
    expect(() => control.reload(defs(), 'ghost')).toThrow(/not defined/)
  })
})
