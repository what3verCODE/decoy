import { type AddressInfo, createServer } from 'node:net'
import { resolve } from 'node:path'
import { run } from '@decoy/cli'
import type { DecoyServer, Logger } from '@decoy/server'
import { createRsbuild } from '@rsbuild/core'

/** A silent logger so the e2e output stays clean (the server logs one line per request). */
const silent: Logger = { info() {}, warn() {}, request() {} }

/** Ask the OS for a free TCP port (Rsbuild needs a concrete port, not `0`). */
function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createServer()
    probe.unref()
    probe.on('error', reject)
    probe.listen(0, () => {
      const { port } = probe.address() as AddressInfo
      probe.close(() => resolvePort(port))
    })
  })
}

export interface RunningStack {
  /** URL of the Rsbuild-served SPA — open this in a browser. */
  spaUrl: string
  /** Base URL of the live Decoy server (its `/__decoy__` control API rides the same port). */
  decoyBaseUrl: string
  /** Tear both servers down. */
  stop(): Promise<void>
}

export interface StartStackOptions {
  /** Port for the standalone Decoy server (`0` → ephemeral). */
  decoyPort: number
  /** Port for the Rsbuild SPA dev server (`0` → ephemeral). */
  spaPort: number
  /** Logger for the Decoy server. Defaults to silent (the e2e harness wants quiet). */
  logger?: Logger
}

/**
 * Boot the example's full stack: a standalone Decoy server (the live fake API,
 * started through the `decoy` CLI's own `run('start', …)` entrypoint — the exact
 * one `bin.js` wraps) plus an Rsbuild dev server hosting the SPA.
 *
 * The SPA calls `/api/*` with ordinary same-origin `fetch`; Rsbuild proxies that
 * prefix to the Decoy server, so the browser sees one origin (no CORS) and the
 * `x-mock-session` header a context carries rides through to the matching session —
 * no app changes. `dev` boots this on fixed ports for a human; the e2e harness
 * passes `0` so every Playwright worker gets its own ephemeral pair.
 */
export async function startStack(options: StartStackOptions): Promise<RunningStack> {
  const cwd = process.cwd()
  const configPath = resolve(cwd, 'decoy.config.ts')

  const server = (await run(
    ['start', '--config', configPath, '--port', String(options.decoyPort)],
    { logger: options.logger ?? silent },
  )) as DecoyServer
  const { port: decoyPort } = server.raw.address() as AddressInfo
  const decoyBaseUrl = `http://localhost:${decoyPort}`

  const spaPort = options.spaPort === 0 ? await freePort() : options.spaPort
  const rsbuild = await createRsbuild({
    cwd,
    rsbuildConfig: {
      source: { entry: { index: resolve(cwd, 'src/main.ts') } },
      html: { template: resolve(cwd, 'src/index.html') },
      server: {
        port: spaPort,
        // The SPA's `/api/*` fetches hit the live Decoy server — forwarded here so
        // the browser stays same-origin and the session header is carried through.
        proxy: { '/api': decoyBaseUrl },
      },
      logLevel: 'error',
    },
  })
  const dev = await rsbuild.startDevServer()

  return {
    spaUrl: `http://localhost:${dev.port}`,
    decoyBaseUrl,
    async stop() {
      await dev.server.close()
      await server.close()
    },
  }
}
