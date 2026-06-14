import type { Collection, Definitions, Route } from '@decoy/core'
import { describe, expect, test } from '@rstest/core'
import type {
  FulfillOptions,
  PlaywrightRequest,
  PlaywrightRoutable,
  PlaywrightRoute,
  RouteHandler,
} from './playwright-types'
import { createPlaywrightRouter } from './router'

const usersRoute: Route = {
  id: 'users-by-id',
  method: 'GET',
  path: '/users/{id}',
  presets: { default: {} },
  variants: {
    ada: { status: 200, body: { id: 42, name: 'Ada' } },
    boom: { status: 500, body: { error: 'upstream exploded' } },
  },
}

const happyPath: Collection = { id: 'happy-path', routes: ['users-by-id:default:ada'] }
const errorState: Collection = { id: 'error-state', routes: ['users-by-id:default:boom'] }

function defs(): Definitions {
  return {
    routes: new Map([[usersRoute.id, usersRoute]]),
    collections: new Map([
      [happyPath.id, happyPath],
      [errorState.id, errorState],
    ]),
  }
}

interface ReqInit {
  method?: string
  url: string
  headers?: Record<string, string>
  postData?: string | null
}

/** A fake Playwright context: captures the registered handler and lets a test fire a request at it. */
function fakeContext() {
  let handler: RouteHandler | undefined
  let routes = 0
  let unroutes = 0

  const routable: PlaywrightRoutable = {
    async route(_url, h) {
      routes += 1
      handler = h
    },
    async unroute(_url, h) {
      unroutes += 1
      if (h === undefined || h === handler) {
        handler = undefined
      }
    },
  }

  return {
    routable,
    get routeCount() {
      return routes
    },
    get unrouteCount() {
      return unroutes
    },
    get installed() {
      return handler !== undefined
    },
    /** Simulate an intercepted request reaching the router; returns what it fulfilled with. */
    async hit(init: ReqInit): Promise<FulfillOptions> {
      if (!handler) {
        throw new Error('no route handler installed')
      }
      const request: PlaywrightRequest = {
        method: () => init.method ?? 'GET',
        url: () => init.url,
        headers: () => init.headers ?? {},
        postData: () => init.postData ?? null,
      }
      let recorded: FulfillOptions | undefined
      const route: PlaywrightRoute = {
        request: () => request,
        async fulfill(options) {
          recorded = options
        },
      }
      await handler(route)
      if (recorded === undefined) {
        throw new Error('handler did not fulfill the route')
      }
      return recorded
    },
  }
}

describe('createPlaywrightRouter', () => {
  test('serves a matched variant via fulfill, with status, JSON body, and content-type', async () => {
    const ctx = fakeContext()
    await createPlaywrightRouter(ctx.routable, {
      definitions: defs(),
      defaultCollection: 'happy-path',
    })

    const fulfilled = await ctx.hit({ url: 'http://localhost/users/42' })

    expect(ctx.routeCount).toBe(1)
    expect(fulfilled.status).toBe(200)
    expect(fulfilled.headers?.['content-type']).toBe('application/json')
    expect(JSON.parse(fulfilled.body ?? '')).toEqual({ id: 42, name: 'Ada' })
  })

  test('fails closed on a miss: configured status + x-mock-miss + diagnostic body', async () => {
    const ctx = fakeContext()
    await createPlaywrightRouter(ctx.routable, {
      definitions: defs(),
      defaultCollection: 'happy-path',
      missStatus: 503,
    })

    const fulfilled = await ctx.hit({ url: 'http://localhost/orders' })

    expect(fulfilled.status).toBe(503)
    expect(fulfilled.headers?.['x-mock-miss']).toBe('true')
    expect(JSON.parse(fulfilled.body ?? '').error).toContain('no route matched GET /orders')
  })

  test('miss status defaults to 501 when unset', async () => {
    const ctx = fakeContext()
    await createPlaywrightRouter(ctx.routable, {
      definitions: defs(),
      defaultCollection: 'happy-path',
    })

    expect((await ctx.hit({ url: 'http://localhost/orders' })).status).toBe(501)
  })

  test('useCollection switches the scenario the next request sees, and returns the selection', async () => {
    const ctx = fakeContext()
    const router = await createPlaywrightRouter(ctx.routable, {
      definitions: defs(),
      defaultCollection: 'happy-path',
    })

    expect((await ctx.hit({ url: 'http://localhost/users/42' })).status).toBe(200)

    const selection = await router.useCollection('error-state')
    expect(selection.collection).toBe('error-state')

    const after = await ctx.hit({ url: 'http://localhost/users/42' })
    expect(after.status).toBe(500)
    expect(JSON.parse(after.body ?? '')).toEqual({ error: 'upstream exploded' })
  })

  test('useRoute pins a variant on the next request; reset restores the baseline', async () => {
    const ctx = fakeContext()
    const router = await createPlaywrightRouter(ctx.routable, {
      definitions: defs(),
      defaultCollection: 'happy-path',
    })

    await router.useRoute('users-by-id', 'default', 'boom')
    expect((await ctx.hit({ url: 'http://localhost/users/42' })).status).toBe(500)

    const selection = await router.reset()
    expect(selection.overrides ?? []).toEqual([])
    expect((await ctx.hit({ url: 'http://localhost/users/42' })).status).toBe(200)
  })

  test('per-context isolation: switching one router does not affect another', async () => {
    const a = fakeContext()
    const b = fakeContext()
    const routerA = await createPlaywrightRouter(a.routable, {
      definitions: defs(),
      defaultCollection: 'happy-path',
    })
    await createPlaywrightRouter(b.routable, {
      definitions: defs(),
      defaultCollection: 'happy-path',
    })

    await routerA.useCollection('error-state')

    expect((await a.hit({ url: 'http://localhost/users/42' })).status).toBe(500)
    expect((await b.hit({ url: 'http://localhost/users/42' })).status).toBe(200)
  })

  test('dispose removes the interception from the context', async () => {
    const ctx = fakeContext()
    const router = await createPlaywrightRouter(ctx.routable, {
      definitions: defs(),
      defaultCollection: 'happy-path',
    })
    expect(ctx.installed).toBe(true)

    await router.dispose()

    expect(ctx.unrouteCount).toBe(1)
    expect(ctx.installed).toBe(false)
  })
})
