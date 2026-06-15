import { createAdminClient } from './admin-client'
import { type Router, SESSION_HEADER } from './router'

/**
 * A sink that accepts extra HTTP headers applied to every outgoing request —
 * structurally a Playwright `BrowserContext` (`setExtraHTTPHeaders`). Typed
 * structurally so the control SDK carries no Playwright dependency.
 */
export interface HeaderSink {
  setExtraHTTPHeaders(headers: Record<string, string>): Promise<void> | void
}

/**
 * A {@link Router} backed by a server **session** (ADR-0011). It owns an isolated
 * selection on a shared server, keyed by `x-mock-session`, so parallel e2e
 * workers never stomp each other. Control calls are proxied to `/admin` carrying
 * the session header; the same header is stamped onto the app's own requests via
 * {@link SessionRouter.stampOn}, so the app's `fetch`/`axios` reach the right
 * session transparently — no app changes.
 */
export interface SessionRouter extends Router {
  /** The session id this router owns. */
  readonly sessionId: string
  /** The header the app must carry to reach this session: `{ 'x-mock-session': id }`. */
  readonly headers: Record<string, string>
  /** Stamp the session header onto a context (e.g. a Playwright `BrowserContext`). */
  stampOn(sink: HeaderSink): Promise<void>
  /** Destroy the server-side session. Safe to call once per router. */
  destroy(): Promise<void>
}

/** Options for {@link createSessionRouter}. */
export interface SessionRouterOptions {
  /** Base URL of the running Decoy server, e.g. `http://localhost:4001`. */
  baseUrl: string
  /** Admin path prefix; defaults to `/admin`. */
  prefix?: string
  /** Adopt an existing session id instead of creating a fresh one. */
  sessionId?: string
  /** Injectable `fetch` (defaults to the global). */
  fetch?: typeof fetch
}

/**
 * Create a {@link SessionRouter}: create (or adopt) a server session and return a
 * transport-agnostic router whose control calls are scoped to it. Delivered as a
 * fixture factory — test code calls `useCollection`/`useRoute`/`reset` and never
 * touches the transport.
 */
export async function createSessionRouter(options: SessionRouterOptions): Promise<SessionRouter> {
  const { baseUrl, prefix, fetch: fetchImpl } = options
  const lifecycle = createAdminClient({ baseUrl, prefix, fetch: fetchImpl })
  const sessionId = options.sessionId ?? (await lifecycle.createSession())
  const control = createAdminClient({ baseUrl, prefix, fetch: fetchImpl, sessionId })

  return {
    sessionId,
    get headers() {
      return { [SESSION_HEADER]: sessionId }
    },
    useCollection(name) {
      return control.useCollection(name)
    },
    useRoute(route, preset, variant) {
      return control.useRoute(route, preset, variant)
    },
    reset() {
      return control.reset()
    },
    async stampOn(sink) {
      await sink.setExtraHTTPHeaders({ [SESSION_HEADER]: sessionId })
    },
    async destroy() {
      await lifecycle.destroySession(sessionId)
    },
  }
}
