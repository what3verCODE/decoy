import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from '@rstest/core'
import type { RequestLogInput, RequestLogStore } from './request-log-store'
import { createMemoryRequestLogStore, createRequestLogStore } from './request-log-store'
import { createSqliteRequestLogStore } from './sqlite-request-log-store'

const dir = mkdtempSync(join(tmpdir(), 'decoy-log-store-'))
let fileCounter = 0
function tmpFile(): string {
  fileCounter += 1
  return join(dir, `store-${fileCounter}.sqlite`)
}

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

function input(path: string, over: Partial<RequestLogInput> = {}): RequestLogInput {
  return {
    service: 'svc',
    method: 'GET',
    path,
    outcome: { type: 'miss', reason: 'no-route' },
    status: 501,
    latencyMs: 1,
    session: 'global',
    ...over,
  }
}

interface ContractOptions {
  capacity?: number
  now?: () => number
}

/** A factory adapting both stores to one signature, so the contract runs over each. */
interface Backend {
  name: string
  make(options?: ContractOptions): RequestLogStore
}

const backends: Backend[] = [
  { name: 'memory', make: (options) => createMemoryRequestLogStore(options) },
  {
    name: 'sqlite',
    make: (options) => createSqliteRequestLogStore({ path: tmpFile(), ...options }),
  },
]

for (const backend of backends) {
  describe(`RequestLogStore contract — ${backend.name}`, () => {
    test('append assigns a monotonic seq + ts; snapshot returns records oldest-first', () => {
      const store = backend.make({ now: () => 1700 })
      const a = store.append(input('/a'))
      const b = store.append(input('/b'))

      expect(a.seq).toBeLessThan(b.seq)
      expect(a.ts).toBe(1700)
      expect(b.ts).toBe(1700)
      expect(store.snapshot().map((r) => r.path)).toEqual(['/a', '/b'])
      const seqs = store.snapshot().map((r) => r.seq)
      expect(seqs[0]).toBeLessThan(seqs[1] as number)
    })

    test('the ring evicts the oldest records past capacity, keeping seq monotonic', () => {
      const store = backend.make({ capacity: 2 })
      const a = store.append(input('/a'))
      store.append(input('/b'))
      store.append(input('/c'))

      const snap = store.snapshot()
      expect(snap.map((r) => r.path)).toEqual(['/b', '/c'])
      expect(snap.every((r) => r.seq > a.seq)).toBe(true)
    })

    test('query scopes by service and session across the retained records', () => {
      const store = backend.make()
      store.append(input('/a', { service: 'users', session: 's1' }))
      store.append(input('/b', { service: 'orders', session: 's1' }))
      store.append(input('/c', { service: 'users', session: 's2' }))

      expect(store.query({ service: 'users' }).map((r) => r.path)).toEqual(['/a', '/c'])
      expect(store.query({ session: 's1' }).map((r) => r.path)).toEqual(['/a', '/b'])
      expect(store.query({ service: 'users', session: 's2' }).map((r) => r.path)).toEqual(['/c'])
      expect(store.query().map((r) => r.path)).toEqual(['/a', '/b', '/c'])
    })

    test('subscribe receives only records appended after subscription, with the stored seq', () => {
      const store = backend.make()
      store.append(input('/before'))

      const seen: Array<{ path: string; seq: number }> = []
      const unsubscribe = store.subscribe((r) => seen.push({ path: r.path, seq: r.seq }))
      const after = store.append(input('/after'))
      unsubscribe()
      store.append(input('/after-unsub'))

      expect(seen).toEqual([{ path: '/after', seq: after.seq }])
    })

    test('snapshot returns a copy — mutating it does not affect the store', () => {
      const store = backend.make()
      store.append(input('/a'))
      const snap = store.snapshot()
      snap.length = 0

      expect(store.snapshot()).toHaveLength(1)
    })

    test('endSession keeps records by default (logs survive session destruction)', () => {
      const store = backend.make()
      store.append(input('/a', { session: 's1' }))
      store.endSession('s1')

      expect(store.query({ session: 's1' })).toHaveLength(1)
    })
  })
}

describe('createSqliteRequestLogStore — durable behavior', () => {
  test('records survive a re-open of the same file (cleanup: never)', () => {
    const path = tmpFile()
    const first = createSqliteRequestLogStore({ path })
    const written = first.append(input('/persist', { session: 's1' }))
    first.close()

    const second = createSqliteRequestLogStore({ path })
    const reread = second.query({ session: 's1' })
    expect(reread).toHaveLength(1)
    expect(reread[0]?.path).toBe('/persist')
    // seq keeps climbing across re-opens (AUTOINCREMENT), never colliding.
    expect(second.append(input('/again')).seq).toBeGreaterThan(written.seq)
    second.close()
  })

  test("cleanup: 'on-session-end' drops a session's records on endSession", () => {
    const store = createSqliteRequestLogStore({ path: tmpFile(), cleanup: 'on-session-end' })
    store.append(input('/a', { session: 's1' }))
    store.append(input('/b', { session: 's2' }))

    store.endSession('s1')
    expect(store.query({ session: 's1' })).toHaveLength(0)
    expect(store.query({ session: 's2' })).toHaveLength(1)
    store.close()
  })

  test("cleanup: 'on-exit' removes the file on close; 'never' keeps it", () => {
    const ephemeral = tmpFile()
    const onExit = createSqliteRequestLogStore({ path: ephemeral, cleanup: 'on-exit' })
    onExit.append(input('/a'))
    onExit.close()
    expect(existsSync(ephemeral)).toBe(false)

    const durable = tmpFile()
    const kept = createSqliteRequestLogStore({ path: durable, cleanup: 'never' })
    kept.append(input('/a'))
    kept.close()
    expect(existsSync(durable)).toBe(true)
  })

  test('mkdir -p creates a missing directory in the path', () => {
    const nested = join(dir, 'a', 'b', 'c', 'logs.sqlite')
    const store = createSqliteRequestLogStore({ path: nested })
    store.append(input('/a'))
    expect(existsSync(nested)).toBe(true)
    store.close()
  })
})

describe('createRequestLogStore — selects the backing store from config (#70)', () => {
  test('defaults to the in-memory store with no config', () => {
    const store = createRequestLogStore()
    store.append(input('/a'))
    expect(store.snapshot()).toHaveLength(1)
    store.close()
  })

  test('builds a durable sqlite store when store: sqlite + a path is resolved', () => {
    const path = tmpFile()
    const store = createRequestLogStore({ store: 'sqlite', path, cleanup: 'never' })
    store.append(input('/a'))
    store.close()
    // The file exists on disk — proof it is the sqlite backing, not the memory ring.
    expect(existsSync(path)).toBe(true)
  })

  test('memory store honors retention.maxRows as the ring capacity', () => {
    const store = createRequestLogStore({ store: 'memory', cleanup: 'never', maxRows: 1 })
    store.append(input('/a'))
    store.append(input('/b'))
    expect(store.snapshot().map((r) => r.path)).toEqual(['/b'])
    store.close()
  })
})
