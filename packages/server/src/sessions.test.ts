import type { Collection, Definitions, Route } from '@decoy/core'
import { describe, expect, test } from '@rstest/core'
import { createSessionRegistry } from './sessions'

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

function definitions(): Definitions {
  return {
    routes: new Map([[usersRoute.id, usersRoute]]),
    collections: new Map([
      [happyPath.id, happyPath],
      [errorState.id, errorState],
    ]),
  }
}

/** Definitions where the success variant returns 201 instead of 200, and error-state is gone. */
function reloadedDefinitions(): Definitions {
  const route: Route = {
    ...usersRoute,
    variants: {
      success: { status: 201, body: { id: 42, name: 'Ada' } },
      error: { status: 500, body: { error: 'boom' } },
    },
  }
  return {
    routes: new Map([[route.id, route]]),
    collections: new Map([[happyPath.id, happyPath]]),
  }
}

const request = { method: 'GET', url: '/users/42', path: '/users/42' } as never

describe('session registry', () => {
  test('resolve(undefined) and resolve("") return the global session', () => {
    const registry = createSessionRegistry(definitions(), 'happy-path')
    expect(registry.resolve(undefined)).toBe(registry.global)
    expect(registry.resolve('')).toBe(registry.global)
    expect(registry.size).toBe(0)
  })

  test('create returns a fresh session isolated from the global session', () => {
    const registry = createSessionRegistry(definitions(), 'happy-path')
    const id = registry.create()
    expect(typeof id).toBe('string')
    expect(registry.size).toBe(1)

    // Switch the session; the global session is untouched.
    registry.resolve(id).setCollection('error-state')
    expect(registry.resolve(id).selection.collection).toBe('error-state')
    expect(registry.global.selection.collection).toBe('happy-path')
  })

  test('concurrent sessions are isolated — switching one does not affect another', () => {
    const registry = createSessionRegistry(definitions(), 'happy-path')
    const a = registry.create()
    const b = registry.create()
    expect(a).not.toBe(b)

    registry.resolve(a).setCollection('error-state')
    expect(registry.resolve(a).selection.collection).toBe('error-state')
    expect(registry.resolve(b).selection.collection).toBe('happy-path')
    expect(registry.resolve(a).match(request).type).toBe('matched')
  })

  test('an unknown session id is lazily auto-created on resolve', () => {
    const registry = createSessionRegistry(definitions(), 'happy-path')
    const controller = registry.resolve('made-up')
    expect(registry.has('made-up')).toBe(true)
    expect(registry.size).toBe(1)
    // The same id resolves to the same controller (sticky state).
    controller.setCollection('error-state')
    expect(registry.resolve('made-up').selection.collection).toBe('error-state')
  })

  test('destroy removes a session; the global session cannot be destroyed', () => {
    const registry = createSessionRegistry(definitions(), 'happy-path')
    const id = registry.create()
    expect(registry.destroy(id)).toBe(true)
    expect(registry.has(id)).toBe(false)
    expect(registry.size).toBe(0)
    // Destroying an unknown id is a no-op (false).
    expect(registry.destroy('ghost')).toBe(false)
    expect(registry.destroy('')).toBe(false)
  })

  test('reapIdle removes sessions idle past the TTL, touching keeps them alive', () => {
    let clock = 1_000
    const registry = createSessionRegistry(definitions(), 'happy-path', {
      idleTtlMs: 100,
      reapIntervalMs: 0, // no background timer; drive reapIdle() manually
      now: () => clock,
    })

    const stale = registry.create()
    const fresh = registry.create()

    clock = 1_080
    registry.resolve(fresh) // touch fresh — resets its last-seen to now

    clock = 1_150 // stale: idle 150ms (> 100); fresh: idle 70ms (< 100)
    const reaped = registry.reapIdle()
    expect(reaped).toEqual([stale])
    expect(registry.has(stale)).toBe(false)
    expect(registry.has(fresh)).toBe(true)
  })

  test('reapIdle never reaps the global session and is a no-op without a TTL', () => {
    let clock = 0
    const registry = createSessionRegistry(definitions(), 'happy-path', {
      now: () => clock,
    })
    registry.resolve('x')
    clock = 10_000_000
    expect(registry.reapIdle()).toEqual([])
    expect(registry.global.selection.collection).toBe('happy-path')
    expect(registry.has('x')).toBe(true)
  })

  test('reload swaps definitions for the global session and every created session', () => {
    const registry = createSessionRegistry(definitions(), 'happy-path')
    const id = registry.create()

    registry.reload(reloadedDefinitions(), 'happy-path')

    expect(
      (registry.global.match(request) as { response: { status: number } }).response.status,
    ).toBe(201)
    expect(
      (registry.resolve(id).match(request) as { response: { status: number } }).response.status,
    ).toBe(201)
  })

  test('reload preserves each session selection by name and reports fallbacks', () => {
    const registry = createSessionRegistry(definitions(), 'happy-path')
    const kept = registry.create()
    const fellBack = registry.create()
    registry.resolve(kept) // touch (no collection change) — stays on happy-path
    registry.resolve(fellBack).setCollection('error-state')

    const results = registry.reload(reloadedDefinitions(), 'happy-path')

    // error-state vanished → that session fell back; happy-path sessions did not.
    const byId = new Map(results.map((r) => [r.session, r]))
    expect(byId.get('global')?.collectionFellBack).toBe(false)
    expect(byId.get(kept)?.collectionFellBack).toBe(false)
    expect(byId.get(fellBack)?.collectionFellBack).toBe(true)
    expect(registry.resolve(fellBack).selection.collection).toBe('happy-path')
  })

  test('a session created after reload uses the reloaded definitions', () => {
    const registry = createSessionRegistry(definitions(), 'happy-path')
    registry.reload(reloadedDefinitions(), 'happy-path')

    const fresh = registry.resolve('born-after')
    expect((fresh.match(request) as { response: { status: number } }).response.status).toBe(201)
    // error-state is gone post-reload, so switching to it fails loud.
    expect(() => fresh.setCollection('error-state')).toThrow(/not defined/)
  })

  test('the background reaper invokes onReap with the reaped ids', async () => {
    let clock = 0
    const reapedBatches: string[][] = []
    const registry = createSessionRegistry(definitions(), 'happy-path', {
      idleTtlMs: 50,
      reapIntervalMs: 5,
      now: () => clock,
      onReap: (ids) => reapedBatches.push(ids),
    })
    const id = registry.create()
    clock = 100
    await new Promise((r) => setTimeout(r, 20))
    registry.stop()

    expect(reapedBatches.flat()).toContain(id)
    expect(registry.has(id)).toBe(false)
  })
})
