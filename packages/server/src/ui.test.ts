import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LoadedService } from '@decoy/config'
import type { Collection, Route } from '@decoy/core'
import { afterEach, beforeEach, describe, expect, test } from '@rstest/core'
import type { Logger } from './logger'
import { createServer, type DecoyServer } from './server'
import { createUiServer, type DecoyUiServer } from './ui'

const silent: Logger = { info() {}, warn() {}, request() {} }

const usersRoute: Route = {
  id: 'users-by-id',
  method: 'GET',
  path: '/users/{id}',
  presets: { default: {} },
  variants: { success: { status: 200, body: { id: 42 } } },
}
const happyPath: Collection = { id: 'happy-path', routes: ['users-by-id:default:success'] }

function service(): LoadedService {
  return {
    name: 'users',
    port: 0,
    defaultCollection: 'happy-path',
    missStatus: 501,
    sessionIdleTtlMs: 1_800_000,
    admin: { enabled: true, prefix: '/admin' },
    definitions: {
      routes: new Map([[usersRoute.id, usersRoute]]),
      collections: new Map([[happyPath.id, happyPath]]),
    },
  }
}

/** A bare HTTP request that lets us set an arbitrary `Host` header (fetch forbids it). */
function rawGet(
  port: number,
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, method: 'GET', headers }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk) => chunks.push(chunk as Buffer))
      res.on('end', () =>
        resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }),
      )
    })
    req.on('error', reject)
    req.end()
  })
}

describe('@decoy/ui server', () => {
  let assetDir: string
  let mock: DecoyServer
  let ui: DecoyUiServer
  let port: number

  beforeEach(async () => {
    assetDir = mkdtempSync(join(tmpdir(), 'decoy-ui-'))
    writeFileSync(join(assetDir, 'index.html'), '<!doctype html><title>decoy</title><div id=app>')
    // A nested hashed asset, as a real prebuilt SPA references from index.html.
    mkdirSync(join(assetDir, 'static', 'js'), { recursive: true })
    writeFileSync(join(assetDir, 'static', 'js', 'index.abc123.js'), 'console.log("decoy")')
    mock = createServer(service(), { logger: silent })
    ui = createUiServer([mock], { assetDir, logger: silent })
    port = await ui.listen()
  })

  afterEach(async () => {
    await ui.close()
    // `mock` is never listened — the UI server only holds its in-process
    // sessions/definitions — so there is no socket to close.
    mock.sessions.stop()
    rmSync(assetDir, { recursive: true, force: true })
  })

  test('serves the SPA index.html at /', async () => {
    const response = await rawGet(port, '/')
    expect(response.status).toBe(200)
    expect(response.body).toContain('id=app')
  })

  test('serves the routes catalog from the same origin (no CORS) via GET /admin/routes', async () => {
    const response = await rawGet(port, '/admin/routes')
    expect(response.status).toBe(200)
    expect(JSON.parse(response.body)).toEqual([
      { id: 'users-by-id', method: 'GET', path: '/users/{id}', presetCount: 1, variantCount: 1 },
    ])
  })

  test('serves a nested hashed static asset with a JS content-type', async () => {
    const response = await rawGet(port, '/static/js/index.abc123.js')
    expect(response.status).toBe(200)
    expect(response.body).toBe('console.log("decoy")')
  })

  test('falls back to index.html for an unknown SPA path (client-side routing)', async () => {
    const response = await rawGet(port, '/routes/users-by-id')
    expect(response.status).toBe(200)
    expect(response.body).toContain('id=app')
  })

  test('rejects a request whose Host header is not loopback (anti-DNS-rebinding)', async () => {
    const response = await rawGet(port, '/admin/routes', { Host: 'evil.example.com' })
    expect(response.status).toBe(403)
  })

  test('accepts an explicit loopback Host', async () => {
    expect((await rawGet(port, '/', { Host: `localhost:${port}` })).status).toBe(200)
    expect((await rawGet(port, '/', { Host: `127.0.0.1:${port}` })).status).toBe(200)
  })
})

describe('@decoy/ui server with a host override', () => {
  let assetDir: string
  let mock: DecoyServer

  beforeEach(() => {
    assetDir = mkdtempSync(join(tmpdir(), 'decoy-ui-'))
    writeFileSync(join(assetDir, 'index.html'), '<!doctype html><div id=app>')
    mock = createServer(service(), { logger: silent })
  })

  afterEach(() => {
    mock.sessions.stop()
    rmSync(assetDir, { recursive: true, force: true })
  })

  test('accepts the overridden Host and warns about the exposure', async () => {
    const warnings: string[] = []
    const logger: Logger = { info() {}, warn: (m) => warnings.push(m), request() {} }
    // 0.0.0.0 is bindable and non-loopback (binds every interface, loopback too).
    const ui = createUiServer([mock], { assetDir, host: '0.0.0.0', logger })
    const port = await ui.listen()
    try {
      expect(warnings.some((w) => /expos/i.test(w))).toBe(true)
      // loopback still works, and so does the overridden host…
      expect((await rawGet(port, '/', { Host: `127.0.0.1:${port}` })).status).toBe(200)
      expect((await rawGet(port, '/', { Host: `0.0.0.0:${port}` })).status).toBe(200)
      // …but a still-different Host is rejected even with an override set
      expect((await rawGet(port, '/', { Host: 'other.host' })).status).toBe(403)
    } finally {
      await ui.close()
    }
  })
})
