import type { LoadedService } from '@decoy/config'
import { type DecoyMiddleware, fromService } from '@decoy/express'
import express, { type Express } from 'express'

/** A real Express app with Decoy embedded as in-process middleware. */
export interface DecoyApp {
  /** The Express app, ready to `listen()`. */
  app: Express
  /**
   * The Decoy middleware's in-process control handle (`useCollection`/`useRoute`/
   * `reset`). Because the mock runs inside this process, scenarios are switched by
   * calling this directly — no standalone server, no `/__decoy__`.
   */
  decoy: DecoyMiddleware
}

/**
 * Build the example app from a loaded service. Decoy is mounted as middleware:
 * a request that matches a mocked route is served from its variant; a miss falls
 * through to the app's own handlers — so `/users/{id}` is faked while the real
 * `/health` handler still answers. "Start the client + the mock" collapses to
 * starting this one app, because the mock lives in-process.
 */
export function buildApp(service: LoadedService): DecoyApp {
  const decoy = fromService(service)

  const app = express()
  // A body parser before the middleware so `body:` matchers can see the payload.
  app.use(express.json())
  app.use(decoy)

  // A real downstream handler in the SAME app — reached only when Decoy misses
  // and falls through. This is the host app's own route, never mocked.
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', from: 'host app' })
  })

  return { app, decoy }
}
