import { loadConfig } from '@decoy/config'
import type { Router } from '@decoy/control'
import {
  type Controller,
  createController,
  type MatchResult,
  type MockResponse,
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
 * same yaml/json sources the standalone server reads (ADR-0007), never hand-built
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
   * miss status comes from the config (`missStatus`, ADR-0005).
   */
  url?: string | RegExp
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const lower = name.toLowerCase()
  return Object.keys(headers).some((key) => key.toLowerCase() === lower)
}

/**
 * Serialize an engine response into Playwright `fulfill` options, mirroring the
 * server's `writeResponse`: a string body passes through; an object/array body is
 * JSON-stringified with `content-type: application/json` inferred unless set; a
 * null/undefined body sends no payload.
 */
function fulfillMatched(response: MockResponse): FulfillOptions {
  const headers = { ...response.headers }
  const body = response.body

  if (body === undefined || body === null) {
    return { status: response.status, headers }
  }
  if (typeof body === 'string') {
    return { status: response.status, headers, body }
  }
  if (!hasHeader(headers, 'content-type')) {
    headers['content-type'] = 'application/json'
  }
  return { status: response.status, headers, body: JSON.stringify(body) }
}

/**
 * Serialize a fail-closed miss, mirroring the server's `writeMiss`: the configured
 * status, an `x-mock-miss: true` header an app/test can hard-assert, and a JSON
 * diagnostic body.
 */
function fulfillMiss(message: string, status: number): FulfillOptions {
  return {
    status,
    headers: { 'x-mock-miss': 'true', 'content-type': 'application/json' },
    body: JSON.stringify({ error: message }),
  }
}

function toFulfill(result: MatchResult, missStatus: number): FulfillOptions {
  return result.type === 'matched'
    ? fulfillMatched(result.response)
    : fulfillMiss(result.message, missStatus)
}

/**
 * Create a {@link PlaywrightRouter}: load the project's `decoy.config.*`, install
 * request interception on a Playwright `BrowserContext` / `Page`, and drive the
 * **in-process** engine over it. The mocks come from the config's yaml/json sources
 * (ADR-0007) — the only required argument is the `target` to intercept; with no
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
      controller.setCollection(name)
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
