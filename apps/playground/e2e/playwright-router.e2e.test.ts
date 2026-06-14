import { resolve } from 'node:path'
import { type LoadedService, loadConfig } from '@decoy/config'
import {
  createPlaywrightRouter,
  type FulfillOptions,
  type PlaywrightRequest,
  type PlaywrightRoutable,
  type PlaywrightRoute,
  type RouteHandler,
} from '@decoy/playwright'
import { afterAll, beforeAll, describe, expect, test } from '@rstest/core'

/**
 * A fake Playwright browser context standing in for `page.route` interception.
 * No real browser runs here; firing `hit()` exercises the exact handler the
 * router installs, so the dogfood asserts the real engine + selection behavior
 * through the PlaywrightRouter's public interface against the playground's real
 * loaded config (the browser → API edge the router fakes).
 */
function fakeBrowserContext() {
  let handler: RouteHandler | undefined
  const routable: PlaywrightRoutable = {
    async route(_url, h) {
      handler = h
    },
    async unroute(_url, h) {
      if (h === undefined || h === handler) {
        handler = undefined
      }
    },
  }
  return {
    routable,
    async hit(url: string): Promise<FulfillOptions> {
      if (!handler) {
        throw new Error('no route handler installed')
      }
      const request: PlaywrightRequest = {
        method: () => 'GET',
        url: () => url,
        headers: () => ({}),
        postData: () => null,
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
        throw new Error('router did not fulfill the request')
      }
      return recorded
    },
  }
}

describe('playground dogfood e2e — PlaywrightRouter', () => {
  let service: LoadedService

  beforeAll(async () => {
    service = await loadConfig({ configPath: resolve(process.cwd(), 'decoy.config.ts') })
  })

  afterAll(() => {})

  function newRouter(ctx: ReturnType<typeof fakeBrowserContext>) {
    return createPlaywrightRouter(ctx.routable, {
      definitions: service.definitions,
      defaultCollection: service.defaultCollection,
      missStatus: service.missStatus,
    })
  }

  test('serves a mocked variant over page.route (browser → API), no server', async () => {
    const ctx = fakeBrowserContext()
    await newRouter(ctx)

    const fulfilled = await ctx.hit('http://api.local/users/42')

    expect(fulfilled.status).toBe(200)
    expect(JSON.parse(fulfilled.body ?? '')).toEqual({ id: 42, name: 'Ada' })
  })

  test('useCollection flips the scenario the next request sees', async () => {
    const ctx = fakeBrowserContext()
    const router = await newRouter(ctx)

    expect((await ctx.hit('http://api.local/users/42')).status).toBe(200)
    await router.useCollection('error-state')
    expect((await ctx.hit('http://api.local/users/42')).status).toBe(500)
  })

  test('a single-route override takes effect next request; reset restores the baseline', async () => {
    const ctx = fakeBrowserContext()
    const router = await newRouter(ctx)

    await router.useRoute('users-by-id', 'default', 'boom')
    expect((await ctx.hit('http://api.local/users/42')).status).toBe(500)

    await router.reset()
    expect((await ctx.hit('http://api.local/users/42')).status).toBe(200)
  })

  test('a miss fails closed: 501 + x-mock-miss', async () => {
    const ctx = fakeBrowserContext()
    await newRouter(ctx)

    const fulfilled = await ctx.hit('http://api.local/orders')

    expect(fulfilled.status).toBe(501)
    expect(fulfilled.headers?.['x-mock-miss']).toBe('true')
  })

  test('parallel contexts are isolated: one switch does not leak into another', async () => {
    const a = fakeBrowserContext()
    const b = fakeBrowserContext()
    const routerA = await newRouter(a)
    await newRouter(b)

    await routerA.useCollection('error-state')

    expect((await a.hit('http://api.local/users/42')).status).toBe(500)
    expect((await b.hit('http://api.local/users/42')).status).toBe(200)
  })
})
