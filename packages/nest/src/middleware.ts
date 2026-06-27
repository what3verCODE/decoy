import type { LoadedService } from '@decoy/config'
import {
  type Controller,
  createController,
  type Definitions,
  type MockResponse,
  type Selection,
} from '@decoy/core'
import { toEnvelope } from './envelope'
import type { DecoyMiddlewareFn, NestResponse } from './nest-types'

/** Options for {@link createDecoyMiddleware}. */
export interface DecoyMiddlewareOptions {
  /** Engine definitions to match requests against (produced by `@decoy/config`). */
  definitions: Definitions
  /** Collection to start on (the baseline scenario). */
  defaultCollection: string
}

/**
 * A Nest functional middleware that embeds the in-process engine, with the canonical
 * JS control API attached. Serves matched routes from mocks and **falls through**
 * (`next()`) on a miss, so it composes with a real Nest app: mock what you want, let
 * everything else hit the host's own controllers. Drive scenarios in-process via
 * {@link DecoyMiddleware.control} — `useCollection`/`useRoute`/`reset` mutate the
 * selection atomically, so the next request reflects the change.
 */
export interface DecoyMiddleware extends DecoyMiddlewareFn {
  /** The canonical JS control API driving this middleware in-process. */
  readonly control: Controller
  /** A read-only snapshot of the current selection. */
  readonly selection: Selection
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const lower = name.toLowerCase()
  return Object.keys(headers).some((key) => key.toLowerCase() === lower)
}

/**
 * Write a matched variant to the Nest response, mirroring the server's
 * `writeResponse`: a string body passes through; an object/array body is
 * JSON-stringified with `content-type: application/json` inferred unless the variant
 * set one; a null/undefined body sends no payload.
 */
function writeMatched(res: NestResponse, response: MockResponse): void {
  res.statusCode = response.status
  for (const [key, value] of Object.entries(response.headers)) {
    res.setHeader(key, value)
  }

  const body = response.body
  if (body === undefined || body === null) {
    res.end()
    return
  }
  if (typeof body === 'string') {
    res.end(body)
    return
  }
  if (!hasHeader(response.headers, 'content-type')) {
    res.setHeader('content-type', 'application/json')
  }
  res.end(JSON.stringify(body))
}

/**
 * Create a {@link DecoyMiddleware} over the given definitions, starting on
 * `defaultCollection`. Each middleware owns its own {@link Controller}, so the host
 * app drives scenarios entirely in-process — no standalone server, no `/__decoy__`. A
 * matched request is served from its variant and ends here; a miss calls `next()` to
 * fall through to the rest of the Nest stack. An unexpected failure while building the
 * envelope or response is passed to `next(error)` for Nest's exception layer. Throws
 * if `defaultCollection` is not defined.
 *
 * Register it from a {@link import('./nest-types').NestModule} via
 * `consumer.apply(middleware).forRoutes('*')`, or let
 * {@link import('./module').DecoyModule} wire it for you.
 */
export function createDecoyMiddleware(options: DecoyMiddlewareOptions): DecoyMiddleware {
  const controller = createController(options.definitions, options.defaultCollection)

  const middleware: DecoyMiddlewareFn = (req, res, next) => {
    let result: ReturnType<Controller['match']>
    try {
      result = controller.match(toEnvelope(req))
    } catch (error) {
      next(error)
      return
    }

    if (result.type === 'matched') {
      writeMatched(res, result.response)
      return
    }
    // A miss is not an error here: fall through to the host app's own handlers.
    next()
  }

  Object.defineProperties(middleware, {
    control: { value: controller, enumerable: true },
    selection: {
      get: () => controller.selection,
      enumerable: true,
    },
  })
  return middleware as DecoyMiddleware
}

/**
 * Build a {@link DecoyMiddleware} directly from a `@decoy/config`
 * {@link LoadedService} — the same resolved artifact the standalone server boots from
 * — embedding its definitions and starting on its `defaultCollection`. The in-process
 * alternative to running the server: identical matching, fallthrough instead of
 * fail-closed.
 */
export function fromService(service: LoadedService): DecoyMiddleware {
  return createDecoyMiddleware({
    definitions: service.definitions,
    defaultCollection: service.defaultCollection,
  })
}
