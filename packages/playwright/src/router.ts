import type { Router } from '@decoy/control'
import {
  type Controller,
  createController,
  type Definitions,
  type MatchResult,
  type MockResponse,
  type Selection,
} from '@decoy/core'
import { toEnvelope } from './envelope'
import type { FulfillOptions, PlaywrightRoutable, PlaywrightRoute } from './playwright-types'

/** Default fail-closed miss status (ADR-0005), matching the server. */
const DEFAULT_MISS_STATUS = 501

/** A {@link Router} backed by the in-process engine over Playwright `page.route`. */
export interface PlaywrightRouter extends Router {
  /** A read-only snapshot of the current selection. */
  readonly selection: Selection
  /** Remove this router's request interception from the context/page. */
  dispose(): Promise<void>
}

/** Options for {@link createPlaywrightRouter}. */
export interface PlaywrightRouterOptions {
  /** Engine definitions to match requests against. */
  definitions: Definitions
  /** Collection to start on (the baseline scenario). */
  defaultCollection: string
  /** Status returned for a fail-closed miss; defaults to 501 (ADR-0005). */
  missStatus?: number
  /** Playwright route URL matcher; defaults to `'**\/*'` (intercept everything). */
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
 * Create a {@link PlaywrightRouter}: install request interception on a Playwright
 * `BrowserContext` / `Page` and drive the **in-process** engine over it. Each
 * router owns its own {@link Controller} (selection), so installing one per
 * Playwright context gives parallel tests isolation for free — no standalone
 * server, no `x-mock-session`. Intercepted requests are matched against the
 * current selection and fulfilled with the resulting variant, or fail closed on a
 * miss. `useCollection`/`useRoute`/`reset` mutate the selection atomically, so the
 * next intercepted request reflects the change.
 */
export async function createPlaywrightRouter(
  target: PlaywrightRoutable,
  options: PlaywrightRouterOptions,
): Promise<PlaywrightRouter> {
  const controller: Controller = createController(options.definitions, options.defaultCollection)
  const missStatus = options.missStatus ?? DEFAULT_MISS_STATUS
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
