import type { Server } from 'node:http'
import { resolve } from 'node:path'
import { loadConfig } from '@decoy/config'
import type { Collection, Definitions, Route } from '@decoy/core'
import { createDecoyMiddleware, fromService } from '@decoy/express'
import { afterAll, beforeAll, describe, expect, test } from '@rstest/core'
import express, { type Express } from 'express'

/** A real Express app listening on an ephemeral port, plus its teardown. */
interface RunningApp {
  base: string
  close(): Promise<void>
}

/** Start a real Express app on an ephemeral port; resolves with its base URL + close(). */
function listen(app: Express): Promise<RunningApp> {
  return new Promise((resolveApp, reject) => {
    const server: Server = app.listen(0, () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolveApp({
        base: `http://localhost:${port}`,
        close: () =>
          new Promise<void>((resolveClose, rejectClose) => {
            server.close((error) => (error ? rejectClose(error) : resolveClose()))
          }),
      })
    })
    server.once('error', reject)
  })
}

describe('@decoy/express integration — real Express app over HTTP (fromService)', () => {
  let running: RunningApp
  let mw: ReturnType<typeof fromService>

  beforeAll(async () => {
    // Boot from the SAME resolved artifact the standalone server uses, so this
    // exercises the real loaded config end-to-end over HTTP, not a hand-built fake.
    const service = await loadConfig({ configPath: resolve(process.cwd(), 'decoy.config.ts') })
    mw = fromService(service)

    const app = express()
    app.use(express.json())
    app.use(mw)
    // A real downstream handler in the SAME app — reached only when decoy misses
    // and falls through via next().
    app.get('/host/ping', (_req, res) => {
      res.json({ from: 'host app' })
    })
    running = await listen(app)
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

  test('falls through to a real downstream handler on an unmatched route', async () => {
    const response = await fetch(`${running.base}/host/ping`)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ from: 'host app' })
  })

  test('in-process control.setCollection changes what the next HTTP request sees', async () => {
    expect((await fetch(`${running.base}/users/42`)).status).toBe(200)

    mw.control.setCollection('error-state')
    const errored = await fetch(`${running.base}/users/42`)
    expect(errored.status).toBe(500)
    expect(await errored.json()).toEqual({ error: 'upstream exploded' })

    // restore the baseline for any later use
    mw.control.setCollection('happy-path')
    expect((await fetch(`${running.base}/users/42`)).status).toBe(200)
  })
})

describe('@decoy/express integration — body matching needs express.json() (createDecoyMiddleware)', () => {
  let running: RunningApp

  // A POST route whose only preset gates on the request body: a body parser must
  // run before the middleware for `body:` matchers to see anything.
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

  beforeAll(async () => {
    const mw = createDecoyMiddleware({ definitions: defs(), defaultCollection: 'only-ada' })

    const app = express()
    app.use(express.json())
    app.use(mw)
    // Downstream handler proving a body that matches no preset falls through.
    app.post('/search', (_req, res) => {
      res.status(200).json({ fellThrough: true })
    })
    running = await listen(app)
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

  test('a body matching no preset falls through to the host handler', async () => {
    const response = await fetch(`${running.base}/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ q: 'grace' }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ fellThrough: true })
  })
})
