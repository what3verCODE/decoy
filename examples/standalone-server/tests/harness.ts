import type { AddressInfo } from 'node:net'
import { resolve } from 'node:path'
import { run } from '@decoy/cli'
import type { DecoyServer, Logger } from '@decoy/server'

// `pnpm --filter <example> test:e2e` runs with the example dir as cwd, so the
// config + its relative mock paths resolve from here (import.meta.url is unreliable
// — the test runner bundles this file to a temp location).
const configPath = resolve(process.cwd(), 'decoy.config.ts')

/** A silent logger so the e2e output stays clean (the CLI logs one line per request by default). */
const silent: Logger = { info() {}, warn() {}, request() {} }

export interface RunningServer {
  /** Base URL of the standalone Decoy server. Its `/__decoy__` API rides the same port. */
  base: string
  /** Stop the server. */
  stop(): Promise<void>
}

/**
 * Boot the standalone Decoy server exactly as `decoy start` does — through the
 * CLI's own `run('start', …)` entrypoint, the same one `bin.js` calls — but on an
 * ephemeral port (`--port 0`) so parallel e2e runs never collide. The `dev` script
 * runs the same CLI on the config's fixed port for a human to `curl`.
 */
export async function startServer(): Promise<RunningServer> {
  const server = (await run(['start', '--config', configPath, '--port', '0'], {
    logger: silent,
  })) as DecoyServer
  const { port } = server.raw.address() as AddressInfo
  return {
    base: `http://localhost:${port}`,
    stop: () => server.close(),
  }
}
