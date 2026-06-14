import type { Collection, Definitions, Route } from '@decoy/core'
import { describe, expect, test } from '@rstest/core'
import { createDecoyMiddleware, fromService } from './middleware'
import type { NestRequest, NestResponse } from './nest-types'

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

function req(init: Partial<NestRequest>): NestRequest {
  return {
    method: init.method ?? 'GET',
    originalUrl: init.originalUrl ?? '/',
    url: init.url,
    headers: init.headers ?? {},
    body: init.body,
  }
}

interface Recorded {
  res: NestResponse
  statusCode: number
  headers: Record<string, string>
  body: string | undefined
  ended: boolean
}

function fakeRes(): Recorded {
  const headers: Record<string, string> = {}
  const recorded: Recorded = {
    statusCode: 200,
    headers,
    body: undefined,
    ended: false,
    res: {
      statusCode: 200,
      setHeader(name: string, value: string) {
        headers[name.toLowerCase()] = value
      },
      end(chunk?: string) {
        recorded.statusCode = recorded.res.statusCode
        recorded.body = chunk
        recorded.ended = true
      },
    },
  }
  return recorded
}

/** Drive a request through a middleware, capturing whether it fell through. */
function run(middleware: ReturnType<typeof createDecoyMiddleware>, request: NestRequest) {
  const rec = fakeRes()
  let nextArg: unknown = 'NOT_CALLED'
  middleware(request, rec.res, (error?: unknown) => {
    nextArg = error
  })
  return { rec, nextCalled: nextArg !== 'NOT_CALLED', nextArg }
}

describe('createDecoyMiddleware', () => {
  test('serves a matched variant and does not fall through', () => {
    const mw = createDecoyMiddleware({ definitions: defs(), defaultCollection: 'happy-path' })
    const { rec, nextCalled } = run(mw, req({ originalUrl: '/users/42' }))

    expect(nextCalled).toBe(false)
    expect(rec.ended).toBe(true)
    expect(rec.statusCode).toBe(200)
    expect(rec.headers['content-type']).toBe('application/json')
    expect(JSON.parse(rec.body ?? '')).toEqual({ id: 42, name: 'Ada' })
  })

  test('falls through to the host app on a miss — no response written', () => {
    const mw = createDecoyMiddleware({ definitions: defs(), defaultCollection: 'happy-path' })
    const { rec, nextCalled, nextArg } = run(mw, req({ originalUrl: '/not-mocked' }))

    expect(nextCalled).toBe(true)
    expect(nextArg).toBeUndefined()
    expect(rec.ended).toBe(false)
    expect(rec.body).toBeUndefined()
  })

  test('passes a string body through without forcing JSON content-type', () => {
    const mw = createDecoyMiddleware({ definitions: defs(), defaultCollection: 'text-state' })
    const { rec } = run(mw, req({ originalUrl: '/users/1' }))

    expect(rec.headers['content-type']).toBe('text/plain')
    expect(rec.body).toBe('hi')
  })

  test('control.setCollection switches the scenario the next request sees', () => {
    const mw = createDecoyMiddleware({ definitions: defs(), defaultCollection: 'happy-path' })
    mw.control.setCollection('error-state')

    const { rec } = run(mw, req({ originalUrl: '/users/42' }))
    expect(rec.statusCode).toBe(500)
    expect(JSON.parse(rec.body ?? '')).toEqual({ error: 'upstream exploded' })
  })

  test('control.useRoute overrides a single route; reset restores the baseline', () => {
    const mw = createDecoyMiddleware({ definitions: defs(), defaultCollection: 'happy-path' })

    mw.control.useRoute('users-by-id', 'default', 'boom')
    expect(run(mw, req({ originalUrl: '/users/42' })).rec.statusCode).toBe(500)

    mw.control.reset()
    expect(run(mw, req({ originalUrl: '/users/42' })).rec.statusCode).toBe(200)
  })

  test('exposes the current selection snapshot', () => {
    const mw = createDecoyMiddleware({ definitions: defs(), defaultCollection: 'happy-path' })
    expect(mw.selection.collection).toBe('happy-path')
    mw.control.setCollection('error-state')
    expect(mw.selection.collection).toBe('error-state')
  })

  test('an unknown default collection throws at creation', () => {
    expect(() => createDecoyMiddleware({ definitions: defs(), defaultCollection: 'nope' })).toThrow(
      /collection "nope" is not defined/,
    )
  })
})

describe('fromService', () => {
  test('builds a middleware from a LoadedService, embedding its definitions', () => {
    const mw = fromService({
      name: 'api',
      port: 4000,
      defaultCollection: 'happy-path',
      missStatus: 501,
      sessionIdleTtlMs: 0,
      definitions: defs(),
      admin: { enabled: false, prefix: '/admin' },
    })

    expect(mw.selection.collection).toBe('happy-path')
    const { rec, nextCalled } = run(mw, req({ originalUrl: '/users/42' }))
    expect(nextCalled).toBe(false)
    expect(rec.statusCode).toBe(200)
  })
})
