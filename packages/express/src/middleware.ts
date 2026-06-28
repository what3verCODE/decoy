import type { LoadedService } from '@decoy/config'
import {
  type Controller,
  createController,
  type Definitions,
  planMatched,
  type ResponsePlan,
  type Selection,
} from '@decoy/core'
import { toEnvelope } from './envelope'
import type { ExpressResponse, NextFunction, RequestHandler } from './express-types'

/** Options for {@link createDecoyMiddleware}. */
export interface DecoyMiddlewareOptions {
  /** Engine definitions to match requests against (produced by `@decoy/config`). */
  definitions: Definitions
  /** Collection to start on (the baseline scenario). */
  defaultCollection: string
}

/**
 * An Express middleware that embeds the in-process engine, with the canonical JS
 * control API attached. Serves matched routes from mocks and **falls through**
 * (`next()`) on a miss, so it composes with a real app: mock what you want,
 * let everything else hit the host's own handlers. Drive scenarios in-process
 * via {@link DecoyMiddleware.control} — `useCollection`/`useRoute`/`reset` mutate
 * the selection atomically, so the next request reflects the change.
 */
export interface DecoyMiddleware extends RequestHandler {
  /** The canonical JS control API driving this middleware in-process. */
  readonly control: Controller
  /** A read-only snapshot of the current selection. */
  readonly selection: Selection
}

/** Write a transport-neutral {@link ResponsePlan} (already serialized by `@decoy/core`) to the Express response. */
function writePlan(res: ExpressResponse, plan: ResponsePlan): void {
  res.statusCode = plan.status
  for (const [key, value] of Object.entries(plan.headers)) {
    res.setHeader(key, value)
  }
  res.end(plan.body)
}

/**
 * Create a {@link DecoyMiddleware} over the given definitions, starting on
 * `defaultCollection`. Each middleware owns its own {@link Controller}, so the
 * host app drives scenarios entirely in-process — no standalone server, no
 * `/__decoy__`. A matched request is served from its variant and ends here; a miss
 * calls `next()` to fall through to the rest of the app's stack. An unexpected
 * failure while building the envelope or response is passed to `next(error)` for
 * the app's error handler. Throws if `defaultCollection` is not defined.
 */
export function createDecoyMiddleware(options: DecoyMiddlewareOptions): DecoyMiddleware {
  const controller = createController(options.definitions, options.defaultCollection)

  const middleware = ((req, res, next: NextFunction) => {
    let result: ReturnType<Controller['match']>
    try {
      result = controller.match(toEnvelope(req))
    } catch (error) {
      next(error)
      return
    }

    if (result.type === 'matched') {
      writePlan(res, planMatched(result.response))
      return
    }
    // A miss is not an error here: fall through to the host app's own handlers.
    next()
  }) as DecoyMiddleware

  Object.defineProperties(middleware, {
    control: { value: controller, enumerable: true },
    selection: {
      get: () => controller.selection,
      enumerable: true,
    },
  })
  return middleware
}

/**
 * Build a {@link DecoyMiddleware} directly from a `@decoy/config`
 * {@link LoadedService} — the same resolved artifact the standalone server boots
 * from — embedding its definitions and starting on its `defaultCollection`. The
 * in-process alternative to running the server: identical matching, fallthrough
 * instead of fail-closed.
 */
export function fromService(service: LoadedService): DecoyMiddleware {
  return createDecoyMiddleware({
    definitions: service.definitions,
    defaultCollection: service.defaultCollection,
  })
}
