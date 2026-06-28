import { loadConfig } from '@decoy/config'
import type { Router } from '@decoy/control'
import {
  type Controller,
  createController,
  type MatchResult,
  planResponse,
  type Selection,
} from '@decoy/core'
import { toEnvelope } from './envelope'
import type { FulfillOptions, PlaywrightRoutable, PlaywrightRoute } from './playwright-types'

/** A {@link Router} backed by the in-process engine over Playwright `page.route`. */
export interface PlaywrightRouter extends Router {
  /** A read-only snapshot of the current selection. */
  readonly selection: Selection
  /** Remove this router's request interception from the context/page. */
  dispose(): Promise<void>
}

/**
 * Options for {@link createPlaywrightRouter}. All optional: with none, the router
 * discovers and loads the project's `decoy.config.*` from {@link process.cwd}. The
 * mocks (routes + collections) the router serves always come from that config — the
 * same yaml/json sources the standalone server reads, never hand-built
 * in-code definitions.
 */
export interface PlaywrightRouterOptions {
  /**
   * Path to a `decoy.config.*` file. When omitted, the config is discovered from
   * {@link cwd} (the same search as `decoy start`).
   */
  configPath?: string
  /**
   * Directory config discovery and the config's relative paths (`routesDir`,
   * `collectionsFile`) resolve against; defaults to `process.cwd()`.
   */
  cwd?: string
  /**
   * Which browser requests this router intercepts — a Playwright `page.route` URL
   * matcher, defaulting to `'**\/*'` (everything). A transport concern, not a mock
   * one: scope it (e.g. `/\/api\//`) so the app's own HTML/JS load untouched, or to
   * mount several routers on one page each owning a different path. The fail-closed
   * miss status comes from the config (`missStatus`).
   */
  url?: string | RegExp
}

/**
 * Map a transport-neutral {@link import('@decoy/core').ResponsePlan} (serialized by
 * the shared core module) to Playwright `fulfill` options, omitting `body` entirely
 * when the plan carries no payload.
 */
function toFulfill(result: MatchResult, missStatus: number): FulfillOptions {
  const plan = planResponse(result, missStatus)
  return plan.body === undefined
    ? { status: plan.status, headers: plan.headers }
    : { status: plan.status, headers: plan.headers, body: plan.body }
}

/**
 * Create a {@link PlaywrightRouter}: load the project's `decoy.config.*`, install
 * request interception on a Playwright `BrowserContext` / `Page`, and drive the
 * **in-process** engine over it. The mocks come from the config's yaml/json sources
 * — the only required argument is the `target` to intercept; with no
 * options the config is discovered from `process.cwd()`. Each router owns its own
 * {@link Controller} (selection), so installing one per Playwright context gives
 * parallel tests isolation for free — no standalone server, no `x-mock-session`.
 * Intercepted requests are matched against the current selection and fulfilled with
 * the resulting variant, or fail closed on a miss. `useCollection`/`useRoute`/
 * `reset` mutate the selection atomically, so the next intercepted request reflects
 * the change.
 */
export async function createPlaywrightRouter(
  target: PlaywrightRoutable,
  options: PlaywrightRouterOptions = {},
): Promise<PlaywrightRouter> {
  const service = await loadConfig({ cwd: options.cwd, configPath: options.configPath })
  const controller: Controller = createController(service.definitions, service.defaultCollection)
  const missStatus = service.missStatus
  const url = options.url ?? '**/*'

  const handler = (route: PlaywrightRoute) => {
    const envelope = toEnvelope(route.request())
    return route.fulfill(toFulfill(controller.match(envelope), missStatus))
  }

  await target.route(url, handler)

  return {
    get selection() {
      return controller.selection
    },
    async useCollection(name) {
      controller.useCollection(name)
      return controller.selection
    },
    async useRoute(route, preset, variant) {
      controller.useRoute(route, preset, variant)
      return controller.selection
    },
    async reset() {
      controller.reset()
      return controller.selection
    },
    async dispose() {
      await target.unroute(url, handler)
    },
  }
}
