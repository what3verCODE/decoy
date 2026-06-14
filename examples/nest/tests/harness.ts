// reflect-metadata must load before the @nestjs decorators in app.ts run.
import 'reflect-metadata'
import { resolve } from 'node:path'
import { loadConfig } from '@decoy/config'
import type { Controller } from '@decoy/core'
import { buildApp } from '../app'

// `pnpm --filter <example> test:e2e` runs with the example dir as cwd, so the config
// + its relative mock paths resolve from here (import.meta.url is unreliable — the
// test runner bundles this file to a temp location).
const configPath = resolve(process.cwd(), 'decoy.config.ts')

export interface RunningApp {
  /** Base URL of the running Nest app. */
  base: string
  /** The embedded engine's in-process control handle — switch scenarios here. */
  control: Controller
  /** Stop the HTTP server. */
  stop(): Promise<void>
}

/**
 * Boot the example app exactly as `dev.ts` does — loading the example's own config
 * and wiring the Decoy module — but on an ephemeral port (`listen(0)`) so parallel
 * e2e runs never collide. The returned `control` drives scenarios in-process, the
 * way a host provider or feature test would.
 */
export async function startApp(): Promise<RunningApp> {
  const service = await loadConfig({ configPath })
  const { app, control } = await buildApp(service)

  await app.listen(0)
  // getUrl() can report the IPv6 loopback (http://[::1]:port); normalize it so fetch
  // hits IPv4 loopback reliably across environments.
  const base = (await app.getUrl()).replace('[::1]', '127.0.0.1')

  return {
    base,
    control,
    stop: () => app.close(),
  }
}
