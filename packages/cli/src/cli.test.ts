import { resolve } from 'node:path'
import type { DecoyServer, Logger } from '@decoy/server'
import { afterEach, describe, expect, test } from '@rstest/core'
import { run } from './cli'

const silent: Logger = { info() {}, warn() {}, request() {} }
const configPath = resolve(process.cwd(), 'fixtures/basic/decoy.config.ts')
const invalidConfigPath = resolve(process.cwd(), 'fixtures/invalid/decoy.config.ts')
const multiConfigPath = resolve(process.cwd(), 'fixtures/multi/decoy.config.ts')

/** The bound port of a running server (its raw address). */
function portOf(server: DecoyServer | undefined): number {
  const address = server?.raw.address()
  return typeof address === 'object' && address ? address.port : 0
}

/** Capture CLI output so a test can assert on the printed report. */
function capture(): { out: (message: string) => void; text: () => string } {
  const lines: string[] = []
  return { out: (message) => lines.push(message), text: () => lines.join('\n') }
}

describe('decoy start (end-to-end through the CLI)', () => {
  let server: DecoyServer | undefined

  afterEach(async () => {
    await server?.close()
    server = undefined
  })

  test('boots from a TS config and serves a matched variant', async () => {
    server = await run(['start', '--config', configPath, '--port', '0'], { logger: silent })
    expect(server).toBeDefined()

    const address = server?.raw.address()
    const port = typeof address === 'object' && address ? address.port : 0
    const response = await fetch(`http://localhost:${port}/users/42`)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ id: 42, name: 'Ada' })
  })

  test('start --json emits machine-readable request lines (no injected logger)', async () => {
    const lines: string[] = []
    const original = console.log
    console.log = (message?: unknown) => lines.push(String(message))
    try {
      server = await run(['start', '--config', configPath, '--port', '0', '--json'])
      const address = server?.raw.address()
      const port = typeof address === 'object' && address ? address.port : 0
      await fetch(`http://localhost:${port}/users/42`)
    } finally {
      console.log = original
    }

    const requestLine = lines.find((l) => l.includes('"outcome"'))
    expect(requestLine).toBeDefined()
    expect(JSON.parse(requestLine ?? '')).toMatchObject({
      method: 'GET',
      path: '/users/42',
      outcome: 'matched',
      status: 200,
      session: 'global',
    })
  })

  test('start --watch boots with hot reload installed and serves a matched variant', async () => {
    server = await run(['start', '--config', configPath, '--port', '0', '--watch'], {
      logger: silent,
    })
    expect(server).toBeDefined()

    const address = server?.raw.address()
    const port = typeof address === 'object' && address ? address.port : 0
    const response = await fetch(`http://localhost:${port}/users/42`)

    // Watcher is installed (resolveWatchPaths found the config + mocks) and boot is unaffected.
    expect(response.status).toBe(200)
  })

  test('rejects an unknown command', async () => {
    await expect(run(['frobnicate'], { logger: silent })).rejects.toThrow(/unknown command/)
  })

  describe('multi-instance topology (array config, ADR-0006)', () => {
    let servers: DecoyServer[] = []

    afterEach(async () => {
      await Promise.all(servers.map((s) => s.close()))
      servers = []
    })

    test('boots one instance per entry, each serving its own routes on its own port', async () => {
      servers = (await run(['start', '--config', multiConfigPath], {
        logger: silent,
      })) as DecoyServer[]
      expect(servers).toHaveLength(2)

      const [users, orders] = servers
      const usersPort = portOf(users)
      const ordersPort = portOf(orders)
      expect(usersPort).not.toBe(ordersPort)

      const fromUsers = await fetch(`http://localhost:${usersPort}/users/1`)
      expect(fromUsers.status).toBe(200)
      expect(await fromUsers.json()).toEqual({ svc: 'users' })

      const fromOrders = await fetch(`http://localhost:${ordersPort}/orders/1`)
      expect(fromOrders.status).toBe(200)
      expect(await fromOrders.json()).toEqual({ svc: 'orders' })

      // Each instance impersonates only its own upstream: the orders route is a
      // miss (fail-closed) on the users instance.
      const crossMiss = await fetch(`http://localhost:${usersPort}/orders/1`)
      expect(crossMiss.status).toBe(501)
    })

    test('rejects --port with a multi-instance config (each service sets its own)', async () => {
      await expect(
        run(['start', '--config', multiConfigPath, '--port', '0'], { logger: silent }),
      ).rejects.toThrow(/multi-instance/)
    })

    test('rejects --watch with a multi-instance config (dev-only, single instance)', async () => {
      await expect(
        run(['start', '--config', multiConfigPath, '--watch'], { logger: silent }),
      ).rejects.toThrow(/multi-instance/)
    })
  })

  test('help returns without starting a server', async () => {
    const result = await run(['help'], { logger: silent })
    expect(result).toBeUndefined()
  })
})

describe('decoy check (CI validation gate)', () => {
  test('a valid config validates clean and exits zero (resolves)', async () => {
    const { out, text } = capture()
    const result = await run(['check', '--config', configPath], { out })

    expect(result).toBeUndefined()
    expect(text()).toMatch(/valid/)
  })

  test('an invalid config rejects (non-zero exit) and reports every issue with file:line', async () => {
    const { out, text } = capture()

    await expect(run(['check', '--config', invalidConfigPath], { out })).rejects.toThrow(
      /validation failed/,
    )

    const report = text()
    expect(report).toMatch(/undefined variant "missing"/)
    expect(report).toMatch(/collections\.yaml:\d+/)
  })
})
