// reflect-metadata must load before any @nestjs decorator runs (Nest reads class
// metadata through it).
import 'reflect-metadata'
import type { Collection, Controller as ControlApi, Definitions, Route } from '@decoy/core'
import { Controller, Get, type INestApplication, Module, Post } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { afterAll, beforeAll, describe, expect, test } from '@rstest/core'
import request from 'supertest'
import { DECOY_CONTROL, DecoyModule } from './module'

// Integration tier (#54): drive @decoy/nest through a REAL NestJS app over loopback
// HTTP via supertest. A package can't depend on the loaded config, so definitions
// are hand-built here — same engine, same fail-closed/fall-through contract the unit
// tests assert against fakes. `app.init()` (not listen) is enough: supertest drives
// the underlying HTTP server directly.

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

describe('@decoy/nest integration — real NestJS app over HTTP (forRoot)', () => {
  let app: INestApplication

  // A real Nest controller in the SAME app, reached only when decoy misses and
  // falls through (no fail-closed 501 from the embedded module).
  @Controller()
  class HostController {
    @Get('host/ping')
    ping() {
      return { from: 'host app' }
    }
  }

  @Module({
    imports: [DecoyModule.forRoot({ definitions: usersDefs(), defaultCollection: 'happy-path' })],
    controllers: [HostController],
  })
  class AppModule {}

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false })
    await app.init()
  })

  afterAll(async () => {
    await app.close()
  })

  test('serves a matched route from its mock variant (status/headers/body)', async () => {
    const response = await request(app.getHttpServer()).get('/users/42')

    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toContain('application/json')
    expect(response.body).toEqual({ id: 42, name: 'Ada' })
  })

  test('falls through to a real Nest controller on an unmatched route', async () => {
    const response = await request(app.getHttpServer()).get('/host/ping')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ from: 'host app' })
  })

  test('the container-resolved DECOY_CONTROL flips the scenario the next request sees', async () => {
    // Resolve the control API the live Nest container registered + exported under
    // DECOY_CONTROL (strict: false searches the imported DecoyModule's exports) —
    // proving the embedded engine's control is wired into real Nest DI, not a fake.
    const control = app.get(DECOY_CONTROL, { strict: false }) as ControlApi

    expect((await request(app.getHttpServer()).get('/users/42')).status).toBe(200)

    control.useCollection('error-state')
    const errored = await request(app.getHttpServer()).get('/users/42')
    expect(errored.status).toBe(500)
    expect(errored.body).toEqual({ error: 'upstream exploded' })

    // restore the baseline for any later use
    control.useCollection('happy-path')
    expect((await request(app.getHttpServer()).get('/users/42')).status).toBe(200)
  })
})

describe('@decoy/nest integration — body matching works out of the box (forRoot)', () => {
  let app: INestApplication

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

  function searchDefs(): Definitions {
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
    imports: [DecoyModule.forRoot({ definitions: searchDefs(), defaultCollection: 'only-ada' })],
    controllers: [SearchController],
  })
  class SearchAppModule {}

  beforeAll(async () => {
    app = await NestFactory.create(SearchAppModule, { logger: false })
    await app.init()
  })

  afterAll(async () => {
    await app.close()
  })

  test('a body matching a preset is served from its variant', async () => {
    const response = await request(app.getHttpServer())
      .post('/search')
      .set('content-type', 'application/json')
      .send({ q: 'ada' })

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ results: ['Ada'] })
  })

  test('a body matching no preset falls through to the host controller', async () => {
    const response = await request(app.getHttpServer())
      .post('/search')
      .set('content-type', 'application/json')
      .send({ q: 'grace' })

    expect(response.status).toBe(201)
    expect(response.body).toEqual({ fellThrough: true })
  })
})
