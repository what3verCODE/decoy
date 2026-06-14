import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { resolve } from 'node:path'
import { loadConfig } from '@decoy/config'
import type { Controller } from '@decoy/core'
import { buildApp } from '../app'

// `pnpm --filter <example> test:e2e` runs with the example dir as cwd, so the
// config + its relative mock paths resolve from here (import.meta.url is unreliable
// — the test runner bundles this file to a temp location).
const configPath = resolve(process.cwd(), 'decoy.config.ts')

export interface RunningApp {
  /** Base URL of the running Express app. */
  base: string
  /** The Decoy middleware's in-process control handle — switch scenarios here. */
  control: Controller
  /** Stop the HTTP server. */
  stop(): Promise<void>
}

/**
 * Boot the example app exactly as `dev.ts` does — loading the example's own
 * config and mounting the Decoy middleware — but on an ephemeral port (`listen(0)`)
 * so parallel e2e runs never collide. The returned `control` drives scenarios
 * in-process, the way a host app or feature test would.
 */
export async function startApp(): Promise<RunningApp> {
  const service = await loadConfig({ configPath })
  const { app, decoy } = buildApp(service)

  const server: Server = await new Promise((ready) => {
    const s = app.listen(0, () => ready(s))
  })
  const { port } = server.address() as AddressInfo

  return {
    base: `http://localhost:${port}`,
    control: decoy.control,
    stop: () =>
      new Promise<void>((done, fail) => {
        server.close((err) => (err ? fail(err) : done()))
      }),
  }
}
