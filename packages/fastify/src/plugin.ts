import type { LoadedService } from '@decoy/config'
import {
  type Controller,
  createController,
  type Definitions,
  planMatched,
  planMiss,
  type ResponsePlan,
  type Selection,
} from '@decoy/core'
import { toEnvelope } from './envelope'
import type { FastifyMockReply, FastifyPluginCallback } from './fastify-types'

/** Options for {@link createDecoyPlugin}. */
export interface DecoyPluginOptions {
  /** Engine definitions to match requests against (produced by `@decoy/config`). */
  definitions: Definitions
  /** Collection to start on (the baseline scenario). */
  defaultCollection: string
  /**
   * HTTP status for a fail-closed miss — when nothing (neither a mock nor a real
   * Fastify route) answers, the not-found handler replies with this status plus
   * `x-mock-miss: true`. Defaults to `501`.
   */
  missStatus?: number
}

/**
 * A Fastify plugin that embeds the in-process engine, with the canonical JS control
 * API attached. Registered with `fastify.register(...)`, it serves matched routes
 * from mocks and **falls through** on a miss, so it composes with a real Fastify app:
 * mock what you want, let everything else hit the host's own routes. When neither a
 * mock nor a real route answers, the request **fails closed** (`501 + x-mock-miss`).
 * Drive scenarios in-process via {@link DecoyPlugin.control} —
 * `useCollection`/`useRoute`/`reset` mutate the selection atomically, so the next
 * request reflects the change.
 */
export interface DecoyPlugin extends FastifyPluginCallback {
  /** The canonical JS control API driving this plugin in-process. */
  readonly control: Controller
  /** A read-only snapshot of the current selection. */
  readonly selection: Selection
}

/**
 * Send a transport-neutral {@link ResponsePlan} (already serialized by `@decoy/core`)
 * through a Fastify reply. The plan's headers (including the inferred content type)
 * are applied before `send`, so Fastify writes the bytes verbatim — identical to the
 * standalone server — rather than re-serializing a raw object.
 */
function sendPlan(reply: FastifyMockReply, plan: ResponsePlan): void {
  reply.code(plan.status)
  for (const [key, value] of Object.entries(plan.headers)) {
    reply.header(key, value)
  }
  reply.send(plan.body)
}

/**
 * Create a {@link DecoyPlugin} over the given definitions, starting on
 * `defaultCollection`. Each plugin owns its own {@link Controller}, so the host app
 * drives scenarios entirely in-process — no standalone server, no `/__decoy__`.
 *
 * The plugin registers two seams on the host instance:
 * - a `preHandler` hook that, for a request whose path a real route already owns,
 *   serves the mock and short-circuits on a match, or falls through to that route on
 *   a miss (it runs after body parsing, so `body:` matchers work);
 * - a not-found handler that catches requests no real route owns — serving the mock
 *   for a purely-mocked path, or failing closed (`missStatus + x-mock-miss`) when the
 *   engine also misses.
 *
 * Both run the same engine, so the contract holds whether or not a real route owns
 * the path. Throws if `defaultCollection` is not defined.
 */
export function createDecoyPlugin(options: DecoyPluginOptions): DecoyPlugin {
  const controller = createController(options.definitions, options.defaultCollection)
  const missStatus = options.missStatus ?? 501

  const plugin = ((instance, _opts, done) => {
    // `preHandler`, not `onRequest`: it runs AFTER Fastify's content-type parser, so
    // `request.body` is populated and `body:` matchers work. (In `onRequest` the body
    // is always undefined.)
    instance.addHook('preHandler', async (request, reply) => {
      const result = controller.match(toEnvelope(request))
      if (result.type === 'matched') {
        sendPlan(reply, planMatched(result.response))
        // Returning the reply after sending stops the lifecycle, so a real route
        // handler for this path is skipped — the mock wins.
        return reply
      }
      // A miss is not an error: returning nothing continues the lifecycle, so a real
      // route (if one owns this path) handles it.
      return undefined
    })

    instance.setNotFoundHandler((request, reply) => {
      const result = controller.match(toEnvelope(request))
      if (result.type === 'matched') {
        sendPlan(reply, planMatched(result.response))
        return
      }
      sendPlan(reply, planMiss(result.message, missStatus))
    })

    done()
  }) as DecoyPlugin

  // Register the hook + not-found handler on the host (parent) context rather than an
  // encapsulated child, so the host's sibling routes are covered — mirroring Express's
  // app-wide `app.use(mw)`. This is exactly what `fastify-plugin` does; setting the
  // symbol directly keeps runtime `dependencies` to `@decoy/*` only.
  ;(plugin as unknown as Record<symbol, unknown>)[Symbol.for('skip-override')] = true

  Object.defineProperties(plugin, {
    control: { value: controller, enumerable: true },
    selection: {
      get: () => controller.selection,
      enumerable: true,
    },
  })
  return plugin
}

/**
 * Build a {@link DecoyPlugin} directly from a `@decoy/config` {@link LoadedService} —
 * the same resolved artifact the standalone server boots from — embedding its
 * definitions, starting on its `defaultCollection`, and failing closed with its
 * `missStatus`. The in-process alternative to running the server: identical matching,
 * fallthrough to the host's routes before fail-closed.
 */
export function fromService(service: LoadedService): DecoyPlugin {
  return createDecoyPlugin({
    definitions: service.definitions,
    defaultCollection: service.defaultCollection,
    missStatus: service.missStatus,
  })
}
