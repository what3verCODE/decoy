import type { Selection } from '@decoy/core'
import { type Router, SESSION_HEADER, type SessionRouter } from './router'

/** Options for {@link createControlClient}. */
export interface ControlClientOptions {
  /** Base URL of the running Decoy server, e.g. `http://localhost:4001`. */
  baseUrl: string
  /** Control path prefix; defaults to `/__decoy__` (matches the server default). */
  prefix?: string
  /** Injectable `fetch` (defaults to the global). */
  fetch?: typeof fetch
}

/**
 * A typed client for the HTTP control API (ADR-0010) — the cross-process mirror
 * of the canonical JS control API. Its own `useCollection`/`useRoute`/`reset`
 * drive the **global** (dev) session; {@link ControlClient.createSession} /
 * {@link ControlClient.session} mint first-class **session handles** that scope
 * control to an isolated selection (ADR-0011). Control methods resolve with the
 * resulting selection so a switch is confirmable; an unknown collection/route/
 * preset/variant or bad input fails loud with the server's error message,
 * mirroring the in-process API.
 */
export interface ControlClient extends Router {
  /** Read the global session's current selection. */
  getSelection(): Promise<Selection>
  /** Create an isolated server session; resolves with its handle. */
  createSession(): Promise<SessionRouter>
  /**
   * Adopt an existing session id, returning a handle over it. Pure — no server
   * round-trip; the server lazily materializes the session on first use.
   */
  session(id: string): SessionRouter
}

interface RequestOptions {
  body?: unknown
  session?: string
}

/** Create a {@link ControlClient} bound to a running server's control API. */
export function createControlClient(options: ControlClientOptions): ControlClient {
  const fetchImpl = options.fetch ?? fetch
  const prefix = options.prefix ?? '/__decoy__'
  const base = `${options.baseUrl}${prefix}`

  async function request(
    method: string,
    sub: string,
    opts: RequestOptions = {},
  ): Promise<Response> {
    const headers: Record<string, string> = {}
    if (opts.body !== undefined) {
      headers['content-type'] = 'application/json'
    }
    if (opts.session) {
      headers[SESSION_HEADER] = opts.session
    }
    return fetchImpl(`${base}${sub}`, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    })
  }

  async function errorMessage(res: Response): Promise<string> {
    const payload = (await res.json().catch(() => undefined)) as { error?: string } | undefined
    return payload?.error ?? `control: HTTP ${res.status}`
  }

  async function selectionFrom(res: Response): Promise<Selection> {
    if (!res.ok) {
      throw new Error(await errorMessage(res))
    }
    return (await res.json().catch(() => undefined)) as Selection
  }

  /** The `Router` verbs over the control API, optionally scoped to a session. */
  function control(session?: string): Router {
    return {
      async useCollection(name) {
        return selectionFrom(await request('POST', '/collection', { body: { name }, session }))
      },
      async useRoute(route, preset, variant) {
        return selectionFrom(
          await request('POST', '/route', { body: { route, preset, variant }, session }),
        )
      },
      async reset() {
        return selectionFrom(await request('POST', '/reset', { session }))
      },
    }
  }

  function makeSession(id: string): SessionRouter {
    const scoped = control(id)
    return {
      id,
      get headers() {
        return { [SESSION_HEADER]: id }
      },
      useCollection: scoped.useCollection,
      useRoute: scoped.useRoute,
      reset: scoped.reset,
      async stampOn(sink) {
        await sink.setExtraHTTPHeaders({ [SESSION_HEADER]: id })
      },
      async destroy() {
        const res = await request('DELETE', `/sessions/${encodeURIComponent(id)}`)
        if (!res.ok && res.status !== 404) {
          throw new Error(await errorMessage(res))
        }
      },
    }
  }

  const global = control()
  return {
    useCollection: global.useCollection,
    useRoute: global.useRoute,
    reset: global.reset,
    async getSelection() {
      return selectionFrom(await request('GET', '/selection'))
    },
    async createSession() {
      const res = await request('POST', '/sessions')
      if (!res.ok) {
        throw new Error(await errorMessage(res))
      }
      const payload = (await res.json().catch(() => undefined)) as { id: string }
      return makeSession(payload.id)
    },
    session(id) {
      return makeSession(id)
    },
  }
}
