import type { Collection, Definitions, Route } from '@decoy/core'
import { describe, expect, test } from '@rstest/core'
import { createRouterFixture } from './fixture'
import type { PlaywrightRoutable, RouteHandler } from './playwright-types'

const usersRoute: Route = {
  id: 'users-by-id',
  method: 'GET',
  path: '/users/{id}',
  presets: { default: {} },
  variants: { ada: { status: 200, body: { name: 'Ada' } } },
}
const happyPath: Collection = { id: 'happy-path', routes: ['users-by-id:default:ada'] }

function defs(): Definitions {
  return {
    routes: new Map([[usersRoute.id, usersRoute]]),
    collections: new Map([[happyPath.id, happyPath]]),
  }
}

function fakeContext() {
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
    get installed() {
      return handler !== undefined
    },
  }
}

describe('createRouterFixture', () => {
  test('provides a router bound to the context, then disposes after use returns', async () => {
    const ctx = fakeContext()
    const fixture = createRouterFixture({ definitions: defs(), defaultCollection: 'happy-path' })

    let sawSelection: string | undefined
    let installedDuringUse = false

    await fixture({ context: ctx.routable }, async (router) => {
      installedDuringUse = ctx.installed
      sawSelection = router.selection.collection
    })

    expect(installedDuringUse).toBe(true)
    expect(sawSelection).toBe('happy-path')
    // dispose ran on teardown
    expect(ctx.installed).toBe(false)
  })

  test('disposes even when the test body throws', async () => {
    const ctx = fakeContext()
    const fixture = createRouterFixture({ definitions: defs(), defaultCollection: 'happy-path' })

    await expect(
      fixture({ context: ctx.routable }, async () => {
        throw new Error('boom in test')
      }),
    ).rejects.toThrow('boom in test')

    expect(ctx.installed).toBe(false)
  })
})
