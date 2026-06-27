import { resolve } from 'node:path'
import { describe, expect, test } from '@rstest/core'
import type {
  FulfillOptions,
  PlaywrightRequest,
  PlaywrightRoutable,
  PlaywrightRoute,
  RouteHandler,
} from './playwright-types'
import { createPlaywrightRouter } from './router'

// The router loads its mocks from a real decoy.config.* (the yaml/json authoring
// path) — never hand-built in-code definitions. These point at the
// fixture under fixtures/users-api (users-by-id route; happy-path/error-state
// collections), exercised either by explicit configPath or cwd discovery.
const FIXTURE_DIR = resolve(process.cwd(), 'fixtures/users-api')
const FIXTURE_CONFIG = resolve(FIXTURE_DIR, 'decoy.config.yaml')

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

  // A stand-in for a Playwright BrowserContext — only route/unroute, capturing the
  // installed handler. Cast through the real Routable: the router registers a 1-arg
  // handler, while Playwright types route()'s callback as (route, request).
  const routable = {
    async route(_url: unknown, h: RouteHandler) {
      routes += 1
      handler = h
    },
    async unroute(_url: unknown, h?: RouteHandler) {
      unroutes += 1
      if (h === undefined || h === handler) {
        handler = undefined
      }
    },
  } as unknown as PlaywrightRoutable

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
  test('loads mocks from decoy.config and serves a matched variant via fulfill', async () => {
    const ctx = fakeContext()
    await createPlaywrightRouter(ctx.routable, { configPath: FIXTURE_CONFIG })

    const fulfilled = await ctx.hit({ url: 'http://localhost/users/42' })

    expect(ctx.routeCount).toBe(1)
    expect(fulfilled.status).toBe(200)
    expect(fulfilled.headers?.['content-type']).toBe('application/json')
    expect(JSON.parse(String(fulfilled.body ?? ''))).toEqual({ id: 42, name: 'Ada' })
  })

  test('discovers the config from cwd when no configPath is given', async () => {
    const ctx = fakeContext()
    await createPlaywrightRouter(ctx.routable, { cwd: FIXTURE_DIR })

    const fulfilled = await ctx.hit({ url: 'http://localhost/users/42' })

    expect(fulfilled.status).toBe(200)
    expect(JSON.parse(String(fulfilled.body ?? ''))).toEqual({ id: 42, name: 'Ada' })
  })

  test("fails closed on a miss with the config's missStatus + x-mock-miss + diagnostic body", async () => {
    const ctx = fakeContext()
    // This fixture sets missStatus: 503 in its config (no in-code override exists).
    const config = resolve(process.cwd(), 'fixtures/miss-503/decoy.config.yaml')
    await createPlaywrightRouter(ctx.routable, { configPath: config })

    const fulfilled = await ctx.hit({ url: 'http://localhost/orders' })

    expect(fulfilled.status).toBe(503)
    expect(fulfilled.headers?.['x-mock-miss']).toBe('true')
    expect(JSON.parse(String(fulfilled.body ?? '')).error).toContain('no route matched GET /orders')
  })

  test('miss status defaults to 501 (the config default) when unset', async () => {
    const ctx = fakeContext()
    await createPlaywrightRouter(ctx.routable, { configPath: FIXTURE_CONFIG })

    expect((await ctx.hit({ url: 'http://localhost/orders' })).status).toBe(501)
  })

  test('useCollection switches the scenario the next request sees, and returns the selection', async () => {
    const ctx = fakeContext()
    const router = await createPlaywrightRouter(ctx.routable, { configPath: FIXTURE_CONFIG })

    expect((await ctx.hit({ url: 'http://localhost/users/42' })).status).toBe(200)

    const selection = await router.useCollection('error-state')
    expect(selection.collection).toBe('error-state')

    const after = await ctx.hit({ url: 'http://localhost/users/42' })
    expect(after.status).toBe(500)
    expect(JSON.parse(String(after.body ?? ''))).toEqual({ error: 'upstream exploded' })
  })

  test('useRoute pins a variant on the next request; reset restores the baseline', async () => {
    const ctx = fakeContext()
    const router = await createPlaywrightRouter(ctx.routable, { configPath: FIXTURE_CONFIG })

    await router.useRoute('users-by-id', 'default', 'boom')
    expect((await ctx.hit({ url: 'http://localhost/users/42' })).status).toBe(500)

    const selection = await router.reset()
    expect(selection.overrides ?? []).toEqual([])
    expect((await ctx.hit({ url: 'http://localhost/users/42' })).status).toBe(200)
  })

  test('per-context isolation: switching one router does not affect another', async () => {
    const a = fakeContext()
    const b = fakeContext()
    const routerA = await createPlaywrightRouter(a.routable, { configPath: FIXTURE_CONFIG })
    await createPlaywrightRouter(b.routable, { configPath: FIXTURE_CONFIG })

    await routerA.useCollection('error-state')

    expect((await a.hit({ url: 'http://localhost/users/42' })).status).toBe(500)
    expect((await b.hit({ url: 'http://localhost/users/42' })).status).toBe(200)
  })

  test('dispose removes the interception from the context', async () => {
    const ctx = fakeContext()
    const router = await createPlaywrightRouter(ctx.routable, { configPath: FIXTURE_CONFIG })
    expect(ctx.installed).toBe(true)

    await router.dispose()

    expect(ctx.unrouteCount).toBe(1)
    expect(ctx.installed).toBe(false)
  })
})
