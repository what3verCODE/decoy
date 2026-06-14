/**
 * The slice of Playwright's API the PlaywrightRouter touches, sourced from the real
 * `@playwright/test` types via `import type` so they can never drift from upstream
 * (the previous hand-copied {@link FulfillOptions} subset, for instance, silently
 * lagged Playwright's real `fulfill` options). `@playwright/test` is a **required
 * peer dependency**; `import type` keeps it type-level only, so the build emits no
 * Playwright import and the package carries zero Playwright runtime weight. The
 * narrowed shapes also keep the router unit-testable with plain fakes — no browser,
 * no standalone server.
 */

import type { BrowserContext, Request, Route } from '@playwright/test'

/** The subset of a Playwright `Request` used to build the request envelope. */
export type PlaywrightRequest = Pick<Request, 'method' | 'url' | 'headers' | 'postData'>

/** Options accepted by {@link PlaywrightRoute.fulfill} — Playwright's own `fulfill` options. */
export type FulfillOptions = NonNullable<Parameters<Route['fulfill']>[0]>

/**
 * The subset of a Playwright `Route` the router fulfills through. `fulfill` is taken
 * verbatim from the real `Route`; `request()` is narrowed to {@link PlaywrightRequest}
 * so a fake need only implement the envelope surface.
 */
export interface PlaywrightRoute extends Pick<Route, 'fulfill'> {
  request(): PlaywrightRequest
}

/** A handler registered for intercepted requests (Playwright's route callback). */
export type RouteHandler = (route: PlaywrightRoute) => unknown

/**
 * The subset of a Playwright `BrowserContext` / `Page` used to install and remove
 * request interception. Per-context interception is what gives parallel tests
 * isolation for free (each context owns its own routing + selection).
 */
export type PlaywrightRoutable = Pick<BrowserContext, 'route' | 'unroute'>
