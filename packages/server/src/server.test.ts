import type { LoadedService } from '@decoy/config'
import type { Collection, Route } from '@decoy/core'
import { afterEach, beforeEach, describe, expect, test } from '@rstest/core'
import type { Logger } from './logger'
import { createServer, type DecoyServer } from './server'

const silent: Logger = { info() {}, warn() {} }

const usersRoute: Route = {
  id: 'users-by-id',
  method: 'GET',
  path: '/users/{id}',
  presets: { default: {} },
  variants: { success: { status: 200, body: { id: 42, name: 'Ada' } } },
}

const happyPath: Collection = {
  id: 'happy-path',
  routes: ['users-by-id:default:success'],
}

function service(): LoadedService {
  return {
    name: 'users',
    port: 0,
    defaultCollection: 'happy-path',
    definitions: {
      routes: new Map([[usersRoute.id, usersRoute]]),
      collections: new Map([[happyPath.id, happyPath]]),
    },
  }
}

describe('createServer (HTTP)', () => {
  let server: DecoyServer
  let base: string

  beforeEach(async () => {
    server = createServer(service(), { logger: silent })
    const port = await server.listen()
    base = `http://localhost:${port}`
  })

  afterEach(async () => {
    await server.close()
  })

  test('serves a matched variant with inferred Content-Type and an {id} param', async () => {
    const response = await fetch(`${base}/users/42`)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(await response.json()).toEqual({ id: 42, name: 'Ada' })
  })

  test('fails closed on a miss with 501 + x-mock-miss', async () => {
    const response = await fetch(`${base}/orders`)

    expect(response.status).toBe(501)
    expect(response.headers.get('x-mock-miss')).toBe('true')
    expect(await response.json()).toEqual({ error: 'no route matched GET /orders' })
  })

  test('method mismatch is a miss', async () => {
    const response = await fetch(`${base}/users/42`, { method: 'POST' })
    expect(response.status).toBe(501)
    expect(response.headers.get('x-mock-miss')).toBe('true')
  })
})
