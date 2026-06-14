import { resolve } from 'node:path'
import { loadConfig } from '@decoy/config'
import { createServer, type DecoyServer, type Logger } from '@decoy/server'
import { createApp, type PlaygroundApp } from '../src/app'

/** The whole running stack under test: a Decoy instance + the example app pointed at it. */
export interface Harness {
  /** Base URL of the running Decoy instance (the faked upstream). */
  decoyBase: string
  /** Base URL of the Decoy `/admin` control API (same port as `decoyBase` here). */
  adminBase: string
  /** Base URL of the example app. */
  appBase: string
  /** The Decoy server (exposes the in-process `control` API too). */
  decoy: DecoyServer
  /** The example app. */
  app: PlaygroundApp
  /** Tear down both servers. */
  stop(): Promise<void>
}

const silent: Logger = { info() {}, warn() {}, request() {} }

/**
 * Boot the dogfood stack: load the playground's `decoy.config.ts`, start a Decoy
 * instance on an ephemeral port, then start the example app with its API base URL
 * pointed at that instance. Returns the live base URLs plus a `stop()` teardown.
 *
 * This is the seam the Router slices (#42, #40) assert through — drive control
 * over `/admin` (or `decoy.control` in-process) and make app requests end-to-end.
 */
export async function startHarness(): Promise<Harness> {
  const configPath = resolve(process.cwd(), 'decoy.config.ts')
  const service = await loadConfig({ configPath })

  const decoy = createServer(service, { logger: silent })
  const decoyPort = await decoy.listen()
  const decoyBase = `http://localhost:${decoyPort}`

  const app = createApp({ apiBaseUrl: decoyBase })
  const appPort = await app.listen(0)
  const appBase = `http://localhost:${appPort}`

  return {
    decoyBase,
    adminBase: `http://localhost:${decoy.adminPort}`,
    appBase,
    decoy,
    app,
    async stop() {
      await app.close()
      await decoy.close()
    },
  }
}
