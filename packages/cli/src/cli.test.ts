import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { type DecoyServer, type DecoyUiServer, type Logger, version } from '@decoy/server'
import { afterEach, beforeEach, describe, expect, test } from '@rstest/core'
import { run } from './cli'
import type { CommandContext, Tui } from './tui'

const silent: Logger = { info() {}, warn() {}, request() {} }
const configPath = resolve(process.cwd(), 'fixtures/basic/decoy.config.ts')
const invalidConfigPath = resolve(process.cwd(), 'fixtures/invalid/decoy.config.ts')
const multiConfigPath = resolve(process.cwd(), 'fixtures/multi/decoy.config.ts')
const badRequestLogConfigPath = resolve(process.cwd(), 'fixtures/bad-requestlog/decoy.config.ts')

/** The bound port of a running server (its raw address). */
function portOf(server: DecoyServer | undefined): number {
  const address = server?.raw.address()
  return typeof address === 'object' && address ? address.port : 0
}

/**
 * Narrow `run`'s `DecoyServer | DecoyServer[] | undefined` union to the single
 * server a single-instance (object) config yields, failing loud if an array
 * slipped through — so single-instance tests assert that contract too.
 */
function single(result: DecoyServer | DecoyServer[] | undefined): DecoyServer | undefined {
  if (Array.isArray(result)) {
    throw new Error('expected a single-instance server, got an array')
  }
  return result
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
    server = single(await run(['start', '--config', configPath, '--port', '0'], { logger: silent }))
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
      server = single(await run(['start', '--config', configPath, '--port', '0', '--json']))
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
    server = single(
      await run(['start', '--config', configPath, '--port', '0', '--watch'], {
        logger: silent,
      }),
    )
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

  describe('--ui (web control panel)', () => {
    let assetDir: string
    let ui: DecoyUiServer | undefined

    beforeEach(() => {
      assetDir = mkdtempSync(join(tmpdir(), 'decoy-cli-ui-'))
      writeFileSync(join(assetDir, 'index.html'), '<!doctype html><div id="root">decoy</div>')
    })

    afterEach(async () => {
      await ui?.close()
      ui = undefined
      rmSync(assetDir, { recursive: true, force: true })
    })

    test('serves the SPA and the same-origin routes catalog on its own loopback port', async () => {
      server = single(
        await run(['start', '--config', configPath, '--port', '0', '--ui', '--ui-port', '0'], {
          logger: silent,
          resolveUi: async () => ({ uiAssetDir: () => assetDir, version }),
          onUiServer: (started) => {
            ui = started
          },
        }),
      )
      expect(ui).toBeDefined()

      const uiPort = (ui?.raw.address() as { port: number }).port
      const page = await fetch(`http://localhost:${uiPort}/`)
      expect(page.status).toBe(200)
      expect(await page.text()).toContain('id="root"')

      const routes = await fetch(`http://localhost:${uiPort}/__decoy__/routes`)
      expect(routes.status).toBe(200)
      expect((await routes.json()) as unknown[]).toHaveLength(1)
    })

    test('warns when the @decoy/ui version does not match decoy, but still starts the panel', async () => {
      const warnings: string[] = []
      const logger: Logger = { info() {}, warn: (m) => warnings.push(m), request() {} }
      server = single(
        await run(['start', '--config', configPath, '--port', '0', '--ui', '--ui-port', '0'], {
          logger,
          resolveUi: async () => ({ uiAssetDir: () => assetDir, version: '9.9.9' }),
          onUiServer: (started) => {
            ui = started
          },
        }),
      )
      expect(ui).toBeDefined()
      expect(warnings.some((w) => w.includes('9.9.9') && /version|match/i.test(w))).toBe(true)
    })

    test('fails closed with a friendly install message when @decoy/ui is not installed', async () => {
      const report = capture()
      server = single(
        await run(['start', '--config', configPath, '--port', '0', '--ui'], {
          logger: silent,
          out: report.out,
          resolveUi: async () => {
            throw new Error("Cannot find package '@decoy/ui'")
          },
          onUiServer: (started) => {
            ui = started
          },
        }),
      )
      // The mock server still boots; only the UI is withheld.
      expect(server).toBeDefined()
      expect(ui).toBeUndefined()
      expect(report.text()).toContain('pnpm add -D @decoy/ui')
    })
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

    test('--watch installs per-instance hot reload and each instance still serves its routes (#51)', async () => {
      servers = (await run(['start', '--config', multiConfigPath, '--watch'], {
        logger: silent,
      })) as DecoyServer[]
      expect(servers).toHaveLength(2)

      const [users, orders] = servers
      // Both instances boot with their own watcher installed (resolveAllWatchPaths
      // per service); --watch with a multi-instance config is no longer rejected.
      const fromUsers = await fetch(`http://localhost:${portOf(users)}/users/1`)
      expect(fromUsers.status).toBe(200)
      expect(await fromUsers.json()).toEqual({ svc: 'users' })

      const fromOrders = await fetch(`http://localhost:${portOf(orders)}/orders/1`)
      expect(fromOrders.status).toBe(200)
      expect(await fromOrders.json()).toEqual({ svc: 'orders' })
    })

    test('a shared sqlite store with cleanup:on-exit is released once on shutdown (#78, #80)', async () => {
      // A multi-instance config shares **one** request-log store (ADR-0017); each
      // instance holds a ref-counted handle on it (#80), so the store closes after
      // the last instance closes, exactly once (a per-instance close would double-
      // close the db and throw). With sqlite + cleanup:on-exit that final close
      // removes the file. The store's config comes from the first service.
      const configDir = mkdtempSync(join(tmpdir(), 'decoy-shared-store-'))
      const dbPath = join(configDir, '.decoy', 'shared.sqlite')
      const service = (name: string, route: string, path: string) => `
        { name: '${name}', port: 0, defaultCollection: 'happy',
          routes: [{ id: '${route}', method: 'GET', path: '${path}', presets: { default: {} },
            variants: { success: { status: 200, body: { svc: '${name}' } } } }],
          collections: [{ id: 'happy', routes: ['${route}:default:success'] }] }`
      writeFileSync(
        join(configDir, 'decoy.config.ts'),
        `export default [
          { ...${service('users', 'users-route', '/users/{id}')},
            requestLog: { store: 'sqlite', path: '.decoy/shared.sqlite', cleanup: 'on-exit' } },
          ${service('orders', 'orders-route', '/orders/{id}')},
        ]`,
      )

      try {
        const booted = (await run(['start', '--config', join(configDir, 'decoy.config.ts')], {
          logger: silent,
        })) as DecoyServer[]
        expect(booted).toHaveLength(2)

        // Drive a request through each instance so both record into the one shared
        // sqlite store, materialising the file.
        await fetch(`http://localhost:${portOf(booted[0])}/users/1`)
        await fetch(`http://localhost:${portOf(booted[1])}/orders/1`)
        expect(existsSync(dbPath)).toBe(true)

        // Closing every instance releases the shared store exactly once: no
        // double-close throw, and on-exit cleanup removes the file + sidecars.
        await Promise.all(booted.map((s) => s.close()))
        for (const suffix of ['', '-journal', '-wal', '-shm']) {
          expect(existsSync(`${dbPath}${suffix}`)).toBe(false)
        }
      } finally {
        rmSync(configDir, { recursive: true, force: true })
      }
    })

    describe('--ui aggregator (#72)', () => {
      let assetDir: string
      let ui: DecoyUiServer | undefined

      beforeEach(() => {
        assetDir = mkdtempSync(join(tmpdir(), 'decoy-cli-multi-ui-'))
        writeFileSync(join(assetDir, 'index.html'), '<!doctype html><div id="root">decoy</div>')
      })

      afterEach(async () => {
        await ui?.close()
        ui = undefined
        rmSync(assetDir, { recursive: true, force: true })
      })

      test('one UI server aggregates every instance: service list, per-instance control, shared logs', async () => {
        servers = (await run(['start', '--config', multiConfigPath, '--ui', '--ui-port', '0'], {
          logger: silent,
          resolveUi: async () => ({ uiAssetDir: () => assetDir, version }),
          onUiServer: (started) => {
            ui = started
          },
        })) as DecoyServer[]
        expect(servers).toHaveLength(2)
        const uiPort = (ui?.raw.address() as { port: number }).port

        // The switcher lists every booted instance (the service axis, ADR-0017).
        const services = (await (
          await fetch(`http://localhost:${uiPort}/__decoy__/services`)
        ).json()) as Array<{
          name: string
        }>
        expect(services).toEqual([{ name: 'users' }, { name: 'orders' }])

        // A ?service= catalog request targets that instance's routes.
        const ordersRoutes = (await (
          await fetch(`http://localhost:${uiPort}/__decoy__/routes?service=orders`)
        ).json()) as Array<{ id: string }>
        expect(ordersRoutes.map((r) => r.id)).toEqual(['orders-route'])

        // Drive a real request through each instance so both record to the shared
        // store, then confirm the aggregated timeline carries both, each labelled.
        await fetch(`http://localhost:${portOf(servers[0])}/users/1`)
        await fetch(`http://localhost:${portOf(servers[1])}/orders/1`)
        const timeline = (await (
          await fetch(`http://localhost:${uiPort}/__decoy__/sessions/global/logs`)
        ).json()) as Array<{ service: string; path: string }>
        expect(timeline.map((r) => r.service)).toEqual(['users', 'orders'])
        expect(timeline.map((r) => r.path)).toEqual(['/users/1', '/orders/1'])
      })
    })
  })

  test('help returns without starting a server', async () => {
    const result = await run(['help'], { logger: silent })
    expect(result).toBeUndefined()
  })

  describe('interactive TUI (--tui, #48)', () => {
    /** A fake TUI that captures the session it is handed and resolves immediately. */
    function fakeTui(): { tui: Tui; session: () => CommandContext | undefined } {
      let captured: CommandContext | undefined
      return {
        tui: {
          logger: silent,
          run: async (ctx) => {
            captured = ctx
          },
        },
        session: () => captured,
      }
    }

    test('boots one in-process server and hands the TUI the live engine + definitions', async () => {
      const fake = fakeTui()
      const result = await run(['start', '--config', configPath, '--port', '0', '--tui'], {
        tui: fake.tui,
      })

      // --tui drives the loop then closes the server, so run resolves with undefined.
      expect(result).toBeUndefined()

      const session = fake.session()
      expect(session).toBeDefined()
      // The definitions handed to the TUI are the fixture's (for /collections, /routes).
      expect(session?.definitions.collections.has('happy-path')).toBe(true)
      expect(session?.definitions.routes.has('users-by-id')).toBe(true)
      expect(session?.control.selection.collection).toBe('happy-path')

      // The controller is the real in-process engine: it matches the fixture variant.
      const match = session?.control.match({
        method: 'GET',
        url: '/users/42',
        path: '/users/42',
        pathParams: { id: '42' },
        query: {},
        headers: {},
        cookies: {},
        body: undefined,
      })
      expect(match?.type).toBe('matched')
      if (match?.type === 'matched') {
        expect(match.response.body).toEqual({ id: 42, name: 'Ada' })
      }
    })

    test('--watch installs single-instance hot reload under the TUI and still serves', async () => {
      const fake = fakeTui()
      const result = await run(
        ['start', '--config', configPath, '--port', '0', '--tui', '--watch'],
        { tui: fake.tui },
      )

      expect(result).toBeUndefined()
      const session = fake.session()
      const match = session?.control.match({
        method: 'GET',
        url: '/users/42',
        path: '/users/42',
        pathParams: { id: '42' },
        query: {},
        headers: {},
        cookies: {},
        body: undefined,
      })
      expect(match?.type).toBe('matched')
    })

    test('rejects a multi-instance config (the TUI drives one engine)', async () => {
      const fake = fakeTui()
      await expect(
        run(['start', '--config', multiConfigPath, '--tui'], { tui: fake.tui }),
      ).rejects.toThrow(/multi-instance/)
    })

    test('rejects --json (non-interactive CI output conflicts with the TUI)', async () => {
      const fake = fakeTui()
      await expect(
        run(['start', '--config', configPath, '--port', '0', '--tui', '--json'], { tui: fake.tui }),
      ).rejects.toThrow(/--json/)
    })
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

  test('an unknown requestLog filename token fails check and names the token (#70)', async () => {
    const { out, text } = capture()

    await expect(run(['check', '--config', badRequestLogConfigPath], { out })).rejects.toThrow(
      /validation failed/,
    )

    const report = text()
    expect(report).toMatch(/requestLog\.path has unknown token/)
    expect(report).toMatch(/\{bogus\}/)
    expect(report).toMatch(/%Q/)
  })
})
