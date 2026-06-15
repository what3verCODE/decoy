import type { LoadedService } from '@decoy/config'
import { type DecoyPlugin, fromService } from '@decoy/fastify'
import Fastify, { type FastifyInstance } from 'fastify'

/** A real Fastify app with Decoy embedded as an in-process plugin. */
export interface DecoyApp {
  /** The Fastify app, already booted (`ready`) and ready to `listen()`. */
  app: FastifyInstance
  /**
   * The Decoy plugin's in-process control handle (`useCollection`/`useRoute`/`reset`).
   * Because the mock runs inside this process, scenarios are switched by calling this
   * directly — no standalone server, no `/__decoy__`.
   */
  decoy: DecoyPlugin
}

/**
 * Build the example app from a loaded service. Decoy is registered as a plugin:
 * a request that matches a mocked route is served from its variant; a miss for a path
 * a real route owns falls through to that route; and a request nothing owns fails
 * closed (`501 + x-mock-miss`). So `/users/{id}` is faked while the real `/health`
 * route still answers, and an unknown path never reaches a real backend (there is
 * none). "Start the client + the mock" collapses to starting this one app, because
 * the mock lives in-process.
 */
export async function buildApp(service: LoadedService): Promise<DecoyApp> {
  const decoy = fromService(service)

  const app = Fastify()
  await app.register(decoy)

  // A real downstream route in the SAME app — reached only when Decoy misses and the
  // request falls through. This is the host app's own route, never mocked.
  app.get('/health', (_request, reply) => {
    reply.send({ status: 'ok', from: 'host app' })
  })

  await app.ready()
  return { app, decoy }
}
