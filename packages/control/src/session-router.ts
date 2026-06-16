import { createControlClient } from './control-client'
import type { SessionRouter } from './router'

/** Options for {@link createSessionRouter}. */
export interface SessionRouterOptions {
  /** Base URL of the running Decoy server, e.g. `http://localhost:4001`. */
  baseUrl: string
  /** Control path prefix; defaults to `/__decoy__`. */
  prefix?: string
  /** Adopt an existing session id instead of creating a fresh one. */
  sessionId?: string
  /** Injectable `fetch` (defaults to the global). */
  fetch?: typeof fetch
}

/**
 * Create a {@link SessionRouter}: the one-call sugar over
 * `createControlClient(...).createSession()`. Creates (or, with `sessionId`,
 * adopts) a server session and returns its first-class handle — a
 * transport-agnostic router whose control calls are scoped to it. Delivered as a
 * fixture factory: test code calls `useCollection`/`useRoute`/`reset` and never
 * touches the transport.
 */
export async function createSessionRouter(options: SessionRouterOptions): Promise<SessionRouter> {
  const { baseUrl, prefix, fetch: fetchImpl, sessionId } = options
  const client = createControlClient({ baseUrl, prefix, fetch: fetchImpl })
  return sessionId === undefined ? client.createSession() : client.session(sessionId)
}
