import type { AddressInfo } from 'node:net'
import { resolve } from 'node:path'
import { loadConfig } from '@decoy/config'
import type { Controller } from '@decoy/core'
import { buildApp } from '../app'

// `pnpm --filter <example> test:e2e` runs with the example dir as cwd, so the config +
// its relative mock paths resolve from here (import.meta.url is unreliable — the test
// runner bundles this file to a temp location).
const configPath = resolve(process.cwd(), 'decoy.config.ts')

export interface RunningApp {
  /** Base URL of the running Fastify app. */
  base: string
  /** The Decoy plugin's in-process control handle — switch scenarios here. */
  control: Controller
  /** Stop the HTTP server. */
  stop(): Promise<void>
}

/**
 * Boot the example app exactly as `dev.ts` does — loading the example's own config and
 * registering the Decoy plugin — but on an ephemeral port (`listen({ port: 0 })`) so
 * parallel e2e runs never collide. The returned `control` drives scenarios in-process,
 * the way a host route or feature test would.
 */
export async function startApp(): Promise<RunningApp> {
  const service = await loadConfig({ configPath })
  const { app, decoy } = await buildApp(service)

  await app.listen({ port: 0 })
  const { port } = app.server.address() as AddressInfo

  return {
    base: `http://localhost:${port}`,
    control: decoy.control,
    stop: () => app.close(),
  }
}
