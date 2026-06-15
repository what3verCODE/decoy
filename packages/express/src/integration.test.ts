import type { Collection, Definitions, Route } from '@decoy/core'
import { beforeAll, describe, expect, test } from '@rstest/core'
import express, { type Express } from 'express'
import request from 'supertest'
import { createDecoyMiddleware, type DecoyMiddleware } from './middleware'

// Integration tier (#54): drive @decoy/express through a REAL Express app over
// loopback HTTP via supertest. Unlike an example, a package can't depend on the
// loaded config, so definitions are hand-built here — same engine, same
// fail-closed/fall-through contract the unit tests assert against fakes.

/** A users-by-id route with a happy (200) and an error (500) variant. */
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

function usersDefs(): Definitions {
  return {
    routes: new Map([[usersRoute.id, usersRoute]]),
    collections: new Map([
      [happyPath.id, happyPath],
      [errorState.id, errorState],
    ]),
  }
}

describe('@decoy/express integration — real Express app over HTTP (supertest)', () => {
  let app: Express
  let mw: DecoyMiddleware

  beforeAll(() => {
    mw = createDecoyMiddleware({ definitions: usersDefs(), defaultCollection: 'happy-path' })

    app = express()
    app.use(express.json())
    app.use(mw)
    // A real downstream handler in the SAME app — reached only when decoy misses
    // and falls through via next().
    app.get('/host/ping', (_req, res) => {
      res.json({ from: 'host app' })
    })
  })

  test('serves a matched route from its mock variant (status/headers/body)', async () => {
    const response = await request(app).get('/users/42')

    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toContain('application/json')
    expect(response.body).toEqual({ id: 42, name: 'Ada' })
  })

  test('falls through to a real downstream handler on an unmatched route', async () => {
    const response = await request(app).get('/host/ping')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ from: 'host app' })
  })

  test('in-process control.useCollection changes what the next HTTP request sees', async () => {
    expect((await request(app).get('/users/42')).status).toBe(200)

    mw.control.useCollection('error-state')
    const errored = await request(app).get('/users/42')
    expect(errored.status).toBe(500)
    expect(errored.body).toEqual({ error: 'upstream exploded' })

    // restore the baseline for any later use
    mw.control.useCollection('happy-path')
    expect((await request(app).get('/users/42')).status).toBe(200)
  })
})

describe('@decoy/express integration — body matching needs express.json()', () => {
  let app: Express

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

  function searchDefs(): Definitions {
    return {
      routes: new Map([[searchRoute.id, searchRoute]]),
      collections: new Map([[onlyAda.id, onlyAda]]),
    }
  }

  beforeAll(() => {
    const mw = createDecoyMiddleware({ definitions: searchDefs(), defaultCollection: 'only-ada' })

    app = express()
    app.use(express.json())
    app.use(mw)
    // Downstream handler proving a body that matches no preset falls through.
    app.post('/search', (_req, res) => {
      res.status(200).json({ fellThrough: true })
    })
  })

  test('a body matching a preset is served from its variant', async () => {
    const response = await request(app)
      .post('/search')
      .set('content-type', 'application/json')
      .send({ q: 'ada' })

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ results: ['Ada'] })
  })

  test('a body matching no preset falls through to the host handler', async () => {
    const response = await request(app)
      .post('/search')
      .set('content-type', 'application/json')
      .send({ q: 'grace' })

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ fellThrough: true })
  })
})
