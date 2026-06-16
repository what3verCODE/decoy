import type { Selection } from '@decoy/core'

/** The `x-mock-session` header that scopes a session's selection (ADR-0011). */
export const SESSION_HEADER = 'x-mock-session'

/**
 * The transport-agnostic control interface (ADR-0011). One set of methods,
 * many transports — a session handle proxies them over `/__decoy__`, a future
 * `PlaywrightRouter` drives the in-process engine — so test code never touches
 * transport details. Mirrors the canonical JS control API (ADR-0010): a Router's
 * `useCollection`/`useRoute`/`reset` are the async, switchable view of
 * `useCollection`/`useRoute`/`reset`. Each call resolves with the resulting
 * selection, so a switch is confirmable.
 */
export interface Router {
  /** Switch the active collection; the next request reflects it. */
  useCollection(name: string): Promise<Selection>
  /** Pin a single route's `preset` slot to `variant` within the active collection. */
  useRoute(route: string, preset: string, variant: string): Promise<Selection>
  /** Drop all per-route overrides, returning to the active collection's baseline. */
  reset(): Promise<Selection>
}

/**
 * A sink that accepts extra HTTP headers applied to every outgoing request —
 * structurally a Playwright `BrowserContext` (`setExtraHTTPHeaders`). Typed
 * structurally so the control SDK carries no Playwright dependency.
 */
export interface HeaderSink {
  setExtraHTTPHeaders(headers: Record<string, string>): Promise<void> | void
}

/**
 * A first-class **session handle** (ADR-0011): a {@link Router} backed by a server
 * session, plus its identity, header, and lifecycle. It owns an isolated selection
 * on a shared server keyed by `x-mock-session`, so parallel e2e workers never stomp
 * each other. Control calls are proxied to the control prefix carrying the session
 * header; the same header is stamped onto the app's own requests via
 * {@link SessionRouter.stampOn}, so the app's `fetch`/`axios` reach the right
 * session transparently — no app changes. Obtain one from
 * `createControlClient(...).createSession()` (fresh) or `.session(id)` (adopt).
 */
export interface SessionRouter extends Router {
  /** The session id this handle owns. */
  readonly id: string
  /** The header the app must carry to reach this session: `{ 'x-mock-session': id }`. */
  readonly headers: Record<string, string>
  /** Stamp the session header onto a context (e.g. a Playwright `BrowserContext`). */
  stampOn(sink: HeaderSink): Promise<void>
  /** Destroy the server-side session. Safe to call once per handle. */
  destroy(): Promise<void>
}
