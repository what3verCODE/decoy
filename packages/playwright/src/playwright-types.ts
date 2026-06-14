/**
 * Structural subsets of the Playwright API the PlaywrightRouter touches. Typed
 * structurally (like {@link import('@decoy/control').HeaderSink}) so this package
 * carries **no** Playwright runtime dependency: a real Playwright `BrowserContext`
 * / `Page` satisfies {@link PlaywrightRoutable}, a real `Route` satisfies
 * {@link PlaywrightRoute}, and a real `Request` satisfies {@link PlaywrightRequest}.
 * The structural shapes also make the router unit-testable with plain fakes — no
 * browser, no standalone server.
 */

/** The subset of a Playwright `Request` used to build the request envelope. */
export interface PlaywrightRequest {
  method(): string
  url(): string
  headers(): Record<string, string>
  postData(): string | null
}

/** Options accepted by {@link PlaywrightRoute.fulfill} (subset of Playwright's). */
export interface FulfillOptions {
  status?: number
  headers?: Record<string, string>
  body?: string
}

/** The subset of a Playwright `Route` the router fulfills through. */
export interface PlaywrightRoute {
  request(): PlaywrightRequest
  fulfill(options: FulfillOptions): Promise<void>
}

/** A handler registered for intercepted requests (Playwright's route callback). */
export type RouteHandler = (route: PlaywrightRoute) => unknown

/**
 * The subset of a Playwright `BrowserContext` / `Page` used to install and remove
 * request interception. Per-context interception is what gives parallel tests
 * isolation for free (each context owns its own routing + selection).
 */
export interface PlaywrightRoutable {
  route(url: string | RegExp, handler: RouteHandler): Promise<void>
  unroute(url: string | RegExp, handler?: RouteHandler): Promise<void>
}
