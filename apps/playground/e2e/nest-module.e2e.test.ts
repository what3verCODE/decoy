// reflect-metadata must load before any @nestjs decorator runs (Nest reads class
// metadata through it).
import 'reflect-metadata'
import type { Server } from 'node:http'
import { resolve } from 'node:path'
import { loadConfig } from '@decoy/config'
import type { Collection, Controller as ControlApi, Definitions, Route } from '@decoy/core'
import { DECOY_CONTROL, DecoyModule } from '@decoy/nest'
import type { INestApplication } from '@nestjs/common'
import { Controller, Get, Module, Post } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { afterAll, beforeAll, describe, expect, test } from '@rstest/core'

/** A real NestJS app listening on an ephemeral port, plus its handle + teardown. */
interface RunningApp {
  base: string
  app: INestApplication
  close(): Promise<void>
}

/**
 * Boot a real NestJS app (default platform-express) on an ephemeral port from a
 * module class or dynamic root module, returning its base URL, the app handle, and
 * close(). `logger: false` silences Nest's startup banner so the output stays clean.
 */
async function bootNest(entry: unknown): Promise<RunningApp> {
  const app = await NestFactory.create(entry as never, { logger: false })
  await app.listen(0)
  const server = app.getHttpServer() as Server
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  return { base: `http://localhost:${port}`, app, close: () => app.close() }
}

describe('@decoy/nest integration — real NestJS app over HTTP (forService)', () => {
  let running: RunningApp

  // A real Nest controller in the SAME app, reached only when decoy misses and
  // falls through (no fail-closed 501 from the embedded module).
  @Controller()
  class HostController {
    @Get('host/ping')
    ping() {
      return { from: 'host app' }
    }
  }

  @Module({ controllers: [HostController] })
  class AppModule {}

  beforeAll(async () => {
    // Embed the SAME resolved artifact the standalone server boots from, so this
    // exercises the real loaded config end-to-end over HTTP — not a hand-built fake.
    const service = await loadConfig({ configPath: resolve(process.cwd(), 'decoy.config.ts') })
    running = await bootNest({ module: AppModule, imports: [DecoyModule.forService(service)] })
  })

  afterAll(async () => {
    await running.close()
  })

  test('serves a matched route from its mock variant (status/headers/body)', async () => {
    const response = await fetch(`${running.base}/users/42`)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(await response.json()).toEqual({ id: 42, name: 'Ada' })
  })

  test('falls through to a real Nest controller on an unmatched route', async () => {
    const response = await fetch(`${running.base}/host/ping`)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ from: 'host app' })
  })

  test('the container-resolved DECOY_CONTROL flips the scenario the next request sees', async () => {
    // Resolve the control API the live Nest container registered + exported under
    // DECOY_CONTROL (strict: false searches the imported DecoyModule's exports) —
    // proving the embedded engine's control is wired into real Nest DI, not a fake.
    const control = running.app.get(DECOY_CONTROL, { strict: false }) as ControlApi

    expect((await fetch(`${running.base}/users/42`)).status).toBe(200)

    control.setCollection('error-state')
    const errored = await fetch(`${running.base}/users/42`)
    expect(errored.status).toBe(500)
    expect(await errored.json()).toEqual({ error: 'upstream exploded' })

    // restore the baseline for any later use
    control.setCollection('happy-path')
    expect((await fetch(`${running.base}/users/42`)).status).toBe(200)
  })
})

describe('@decoy/nest integration — body matching works out of the box (forRoot)', () => {
  let running: RunningApp

  // A POST route whose only preset gates on the request body. Unlike the bare
  // Express adapter (which needs express.json() mounted first), Nest's default
  // platform parses the body before middleware, so `body:` matching just works.
  const searchRoute: Route = {
    id: 'search',
    method: 'POST',
    path: '/search',
    presets: { ada: { body: { q: 'ada' } } },
    variants: {
      found: { status: 200, body: { results: ['Ada'] } },
    },
  }
  const onlyAda: Collection = { id: 'only-ada', routes: ['search:ada:found'] }

  function defs(): Definitions {
    return {
      routes: new Map([[searchRoute.id, searchRoute]]),
      collections: new Map([[onlyAda.id, onlyAda]]),
    }
  }

  // Downstream controller proving a body that matches no preset falls through.
  @Controller()
  class SearchController {
    @Post('search')
    fellThrough() {
      return { fellThrough: true }
    }
  }

  @Module({
    imports: [DecoyModule.forRoot({ definitions: defs(), defaultCollection: 'only-ada' })],
    controllers: [SearchController],
  })
  class SearchAppModule {}

  beforeAll(async () => {
    running = await bootNest(SearchAppModule)
  })

  afterAll(async () => {
    await running.close()
  })

  test('a body matching a preset is served from its variant', async () => {
    const response = await fetch(`${running.base}/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ q: 'ada' }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ results: ['Ada'] })
  })

  test('a body matching no preset falls through to the host controller', async () => {
    const response = await fetch(`${running.base}/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ q: 'grace' }),
    })

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ fellThrough: true })
  })
})
