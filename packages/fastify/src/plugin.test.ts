import type { Collection, Definitions, Route } from '@decoy/core'
import { describe, expect, test } from '@rstest/core'
import type { FastifyMockReply, FastifyMockRequest } from './fastify-types'
import { createDecoyPlugin, type DecoyPlugin, fromService } from './plugin'

const usersRoute: Route = {
  id: 'users-by-id',
  method: 'GET',
  path: '/users/{id}',
  presets: { default: {} },
  variants: {
    ada: { status: 200, body: { id: 42, name: 'Ada' } },
    boom: { status: 500, body: { error: 'upstream exploded' } },
    text: { status: 200, headers: { 'content-type': 'text/plain' }, body: 'hi' },
  },
}

const happyPath: Collection = { id: 'happy-path', routes: ['users-by-id:default:ada'] }
const errorState: Collection = { id: 'error-state', routes: ['users-by-id:default:boom'] }
const textState: Collection = { id: 'text-state', routes: ['users-by-id:default:text'] }

function defs(): Definitions {
  return {
    routes: new Map([[usersRoute.id, usersRoute]]),
    collections: new Map([
      [happyPath.id, happyPath],
      [errorState.id, errorState],
      [textState.id, textState],
    ]),
  }
}

function req(init: Partial<FastifyMockRequest>): FastifyMockRequest {
  return {
    method: init.method ?? 'GET',
    url: init.url ?? '/',
    headers: init.headers ?? {},
    body: init.body,
  }
}

interface Recorded {
  reply: FastifyMockReply
  statusCode: number
  headers: Record<string, string>
  body: string | undefined
  sent: boolean
}

function fakeReply(): Recorded {
  const headers: Record<string, string> = {}
  const recorded: Recorded = {
    statusCode: 200,
    headers,
    body: undefined,
    sent: false,
    // A minimal stand-in for a Fastify Reply — only the surface the plugin writes
    // through (code/header/send). Cast through the real FastifyMockReply, whose
    // methods return the full reply; the fake's recorders return `this`.
    reply: {
      code(status: number) {
        recorded.statusCode = status
        return this
      },
      header(name: string, value: string) {
        headers[name.toLowerCase()] = value
        return this
      },
      send(payload?: unknown) {
        recorded.body = payload as string | undefined
        recorded.sent = true
        return this
      },
    } as unknown as FastifyMockReply,
  }
  return recorded
}

type PreHandlerHook = (request: FastifyMockRequest, reply: FastifyMockReply) => Promise<unknown>
type NotFoundHandler = (request: FastifyMockRequest, reply: FastifyMockReply) => void

interface FakeInstance {
  addHook(name: string, fn: PreHandlerHook): void
  setNotFoundHandler(fn: NotFoundHandler): void
}

type RegisterFn = (instance: FakeInstance, opts: unknown, done: () => void) => void

/**
 * Run a plugin against a fake Fastify instance, capturing the two seams it registers
 * (the preHandler hook + the not-found handler) so a unit test can drive each directly
 * with the narrowed request/reply fakes — no running Fastify app.
 */
function register(plugin: DecoyPlugin): { preHandler: PreHandlerHook; notFound: NotFoundHandler } {
  let preHandler: PreHandlerHook | undefined
  let notFound: NotFoundHandler | undefined
  const instance: FakeInstance = {
    addHook(name, fn) {
      if (name === 'preHandler') {
        preHandler = fn
      }
    },
    setNotFoundHandler(fn) {
      notFound = fn
    },
  }
  ;(plugin as unknown as RegisterFn)(instance, {}, () => {})
  if (!preHandler || !notFound) {
    throw new Error('plugin did not register both seams')
  }
  return { preHandler, notFound }
}

describe('createDecoyPlugin — preHandler hook (path a real route may own)', () => {
  test('serves a matched variant and short-circuits (returns the reply)', async () => {
    const plugin = createDecoyPlugin({ definitions: defs(), defaultCollection: 'happy-path' })
    const { preHandler } = register(plugin)
    const rec = fakeReply()

    const returned = await preHandler(req({ url: '/users/42' }), rec.reply)

    expect(returned).toBe(rec.reply)
    expect(rec.sent).toBe(true)
    expect(rec.statusCode).toBe(200)
    expect(rec.headers['content-type']).toBe('application/json')
    expect(JSON.parse(rec.body ?? '')).toEqual({ id: 42, name: 'Ada' })
  })

  test('falls through on a miss — returns undefined, writes nothing', async () => {
    const plugin = createDecoyPlugin({ definitions: defs(), defaultCollection: 'happy-path' })
    const { preHandler } = register(plugin)
    const rec = fakeReply()

    const returned = await preHandler(req({ url: '/not-mocked' }), rec.reply)

    expect(returned).toBeUndefined()
    expect(rec.sent).toBe(false)
    expect(rec.body).toBeUndefined()
  })

  test('passes a string body through without forcing JSON content-type', async () => {
    const plugin = createDecoyPlugin({ definitions: defs(), defaultCollection: 'text-state' })
    const { preHandler } = register(plugin)
    const rec = fakeReply()

    await preHandler(req({ url: '/users/1' }), rec.reply)

    expect(rec.headers['content-type']).toBe('text/plain')
    expect(rec.body).toBe('hi')
  })
})

describe('createDecoyPlugin — not-found handler (path no real route owns)', () => {
  test('serves a matched variant for a purely-mocked path', () => {
    const plugin = createDecoyPlugin({ definitions: defs(), defaultCollection: 'happy-path' })
    const { notFound } = register(plugin)
    const rec = fakeReply()

    notFound(req({ url: '/users/42' }), rec.reply)

    expect(rec.statusCode).toBe(200)
    expect(JSON.parse(rec.body ?? '')).toEqual({ id: 42, name: 'Ada' })
  })

  test('fails closed (501 + x-mock-miss) when the engine also misses', () => {
    const plugin = createDecoyPlugin({ definitions: defs(), defaultCollection: 'happy-path' })
    const { notFound } = register(plugin)
    const rec = fakeReply()

    notFound(req({ url: '/nope' }), rec.reply)

    expect(rec.statusCode).toBe(501)
    expect(rec.headers['x-mock-miss']).toBe('true')
    expect(rec.headers['content-type']).toBe('application/json')
    expect(JSON.parse(rec.body ?? '')).toHaveProperty('error')
  })

  test('a custom missStatus is used for the fail-closed reply', () => {
    const plugin = createDecoyPlugin({
      definitions: defs(),
      defaultCollection: 'happy-path',
      missStatus: 503,
    })
    const { notFound } = register(plugin)
    const rec = fakeReply()

    notFound(req({ url: '/nope' }), rec.reply)

    expect(rec.statusCode).toBe(503)
    expect(rec.headers['x-mock-miss']).toBe('true')
  })
})

describe('createDecoyPlugin — in-process control', () => {
  test('control.useCollection switches the scenario the next request sees', async () => {
    const plugin = createDecoyPlugin({ definitions: defs(), defaultCollection: 'happy-path' })
    const { preHandler } = register(plugin)
    plugin.control.useCollection('error-state')

    const rec = fakeReply()
    await preHandler(req({ url: '/users/42' }), rec.reply)

    expect(rec.statusCode).toBe(500)
    expect(JSON.parse(rec.body ?? '')).toEqual({ error: 'upstream exploded' })
  })

  test('control.useRoute overrides a single route; reset restores the baseline', async () => {
    const plugin = createDecoyPlugin({ definitions: defs(), defaultCollection: 'happy-path' })
    const { preHandler } = register(plugin)

    plugin.control.useRoute('users-by-id', 'default', 'boom')
    const overridden = fakeReply()
    await preHandler(req({ url: '/users/42' }), overridden.reply)
    expect(overridden.statusCode).toBe(500)

    plugin.control.reset()
    const restored = fakeReply()
    await preHandler(req({ url: '/users/42' }), restored.reply)
    expect(restored.statusCode).toBe(200)
  })

  test('exposes the current selection snapshot', () => {
    const plugin = createDecoyPlugin({ definitions: defs(), defaultCollection: 'happy-path' })
    expect(plugin.selection.collection).toBe('happy-path')
    plugin.control.useCollection('error-state')
    expect(plugin.selection.collection).toBe('error-state')
  })

  test('an unknown default collection throws at creation', () => {
    expect(() => createDecoyPlugin({ definitions: defs(), defaultCollection: 'nope' })).toThrow(
      /collection "nope" is not defined/,
    )
  })
})

describe('fromService', () => {
  test('builds a plugin from a LoadedService, embedding its definitions and missStatus', () => {
    const plugin = fromService({
      name: 'api',
      port: 4000,
      defaultCollection: 'happy-path',
      missStatus: 503,
      sessionIdleTtlMs: 0,
      definitions: defs(),
      admin: { enabled: false, prefix: '/admin' },
    })
    const { notFound } = register(plugin)

    expect(plugin.selection.collection).toBe('happy-path')

    const rec = fakeReply()
    notFound(req({ url: '/nope' }), rec.reply)
    expect(rec.statusCode).toBe(503)
  })
})
