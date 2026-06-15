import { describe, expect, test } from '@rstest/core'
import type { RequestLog } from './logger'
import { createMemoryRequestLogStore } from './request-log-store'

function log(path: string): RequestLog {
  return {
    method: 'GET',
    path,
    outcome: { type: 'miss', reason: 'no-route' },
    status: 501,
    latencyMs: 1,
    session: 'global',
  }
}

describe('createMemoryRequestLogStore', () => {
  test('append assigns a monotonic seq, snapshot returns records oldest-first', () => {
    const store = createMemoryRequestLogStore()
    const a = store.append(log('/a'))
    const b = store.append(log('/b'))

    expect(a.seq).toBe(1)
    expect(b.seq).toBe(2)
    expect(store.snapshot().map((r) => r.path)).toEqual(['/a', '/b'])
    expect(store.snapshot().map((r) => r.seq)).toEqual([1, 2])
  })

  test('the ring evicts the oldest records past capacity, keeping seq monotonic', () => {
    const store = createMemoryRequestLogStore({ capacity: 2 })
    store.append(log('/a'))
    store.append(log('/b'))
    store.append(log('/c'))

    expect(store.snapshot().map((r) => r.path)).toEqual(['/b', '/c'])
    expect(store.snapshot().map((r) => r.seq)).toEqual([2, 3])
  })

  test('subscribe receives only records appended after subscription', () => {
    const store = createMemoryRequestLogStore()
    store.append(log('/before'))

    const seen: string[] = []
    const unsubscribe = store.subscribe((r) => seen.push(r.path))
    store.append(log('/after-1'))
    store.append(log('/after-2'))
    unsubscribe()
    store.append(log('/after-unsub'))

    expect(seen).toEqual(['/after-1', '/after-2'])
  })

  test('a subscriber sees the same store-assigned seq as the snapshot', () => {
    const store = createMemoryRequestLogStore()
    let delivered = 0
    store.subscribe((r) => {
      delivered = r.seq
    })
    const appended = store.append(log('/x'))

    expect(delivered).toBe(appended.seq)
  })

  test('snapshot returns a copy — mutating it does not affect the store', () => {
    const store = createMemoryRequestLogStore()
    store.append(log('/a'))
    const snap = store.snapshot()
    snap.length = 0

    expect(store.snapshot()).toHaveLength(1)
  })
})
