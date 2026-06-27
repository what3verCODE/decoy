import { resolve } from 'node:path'
import { describe, expect, test } from '@rstest/core'
import { createRouterFixture } from './fixture'
import type { PlaywrightRoutable, RouteHandler } from './playwright-types'

// The fixture loads its mocks from a real decoy.config.*; point it at
// the shared fixtures/users-api config (happy-path baseline).
const FIXTURE_CONFIG = resolve(process.cwd(), 'fixtures/users-api/decoy.config.yaml')

function fakeContext() {
  let handler: RouteHandler | undefined
  // A stand-in for a Playwright BrowserContext (see router.test for the cast rationale).
  const routable = {
    async route(_url: unknown, h: RouteHandler) {
      handler = h
    },
    async unroute(_url: unknown, h?: RouteHandler) {
      if (h === undefined || h === handler) {
        handler = undefined
      }
    },
  } as unknown as PlaywrightRoutable
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
    const fixture = createRouterFixture({ configPath: FIXTURE_CONFIG })

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
    const fixture = createRouterFixture({ configPath: FIXTURE_CONFIG })

    await expect(
      fixture({ context: ctx.routable }, async () => {
        throw new Error('boom in test')
      }),
    ).rejects.toThrow('boom in test')

    expect(ctx.installed).toBe(false)
  })
})
