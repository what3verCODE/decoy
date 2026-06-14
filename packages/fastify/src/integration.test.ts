import type { Collection, Definitions, Route } from '@decoy/core'
import { beforeAll, describe, expect, test } from '@rstest/core'
import Fastify, { type FastifyInstance } from 'fastify'
import request from 'supertest'
import { createDecoyPlugin, type DecoyPlugin } from './plugin'

// Integration tier (#54): drive @decoy/fastify through a REAL Fastify app over
// loopback HTTP via supertest (app.server after app.ready()). Unlike an example, a
// package can't depend on the loaded config, so definitions are hand-built here —
// same engine, same fall-through / fail-closed contract the unit tests assert against
// fakes.

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

describe('@decoy/fastify integration — real Fastify app over HTTP (supertest)', () => {
  let app: FastifyInstance
  let plugin: DecoyPlugin

  beforeAll(async () => {
    plugin = createDecoyPlugin({ definitions: usersDefs(), defaultCollection: 'happy-path' })

    app = Fastify()
    await app.register(plugin)
    // A real downstream handler in the SAME app — reached only when decoy misses and
    // falls through. Its path is NOT mocked, so the engine never matches it.
    app.get('/host/ping', (_request, reply) => {
      reply.send({ from: 'host app' })
    })
    await app.ready()
  })

  test('serves a matched route from its mock variant (status/headers/body)', async () => {
    const response = await request(app.server).get('/users/42')

    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toContain('application/json')
    expect(response.body).toEqual({ id: 42, name: 'Ada' })
  })

  test('falls through to a real downstream handler on an unmatched route', async () => {
    const response = await request(app.server).get('/host/ping')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ from: 'host app' })
  })

  test('fails closed (501 + x-mock-miss) when neither a mock nor a real route answers', async () => {
    const response = await request(app.server).get('/nope')

    expect(response.status).toBe(501)
    expect(response.headers['x-mock-miss']).toBe('true')
    expect(response.body).toHaveProperty('error')
  })

  test('in-process control.setCollection changes what the next HTTP request sees', async () => {
    expect((await request(app.server).get('/users/42')).status).toBe(200)

    plugin.control.setCollection('error-state')
    const errored = await request(app.server).get('/users/42')
    expect(errored.status).toBe(500)
    expect(errored.body).toEqual({ error: 'upstream exploded' })

    // restore the baseline for any later use
    plugin.control.setCollection('happy-path')
    expect((await request(app.server).get('/users/42')).status).toBe(200)
  })
})

describe('@decoy/fastify integration — a mock overrides a real route on the same path', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    const plugin = createDecoyPlugin({ definitions: usersDefs(), defaultCollection: 'happy-path' })

    app = Fastify()
    await app.register(plugin)
    // A real handler ON THE MOCKED PATH: the onRequest hook matches first and serves
    // the mock, short-circuiting before this handler ever runs.
    app.get('/users/:id', (_request, reply) => {
      reply.send({ from: 'real handler' })
    })
    await app.ready()
  })

  test('the mock wins over a registered real route handler', async () => {
    const response = await request(app.server).get('/users/42')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ id: 42, name: 'Ada' })
  })
})

describe('@decoy/fastify integration — body matching via Fastify default JSON parser', () => {
  let app: FastifyInstance

  // A POST route whose only preset gates on the request body. Fastify parses
  // application/json out of the box (no body-parser plugin needed, unlike Express),
  // so `body:` matchers see the parsed payload here.
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

  beforeAll(async () => {
    const plugin = createDecoyPlugin({ definitions: searchDefs(), defaultCollection: 'only-ada' })

    app = Fastify()
    await app.register(plugin)
    // Downstream handler proving a body that matches no preset falls through.
    app.post('/search', (_request, reply) => {
      reply.send({ fellThrough: true })
    })
    await app.ready()
  })

  test('a body matching a preset is served from its variant', async () => {
    const response = await request(app.server)
      .post('/search')
      .set('content-type', 'application/json')
      .send({ q: 'ada' })

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ results: ['Ada'] })
  })

  test('a body matching no preset falls through to the host handler', async () => {
    const response = await request(app.server)
      .post('/search')
      .set('content-type', 'application/json')
      .send({ q: 'grace' })

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ fellThrough: true })
  })
})
