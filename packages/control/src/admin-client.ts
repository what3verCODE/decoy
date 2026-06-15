import type { Selection } from '@decoy/core'
import { SESSION_HEADER } from './router'

/** Options for {@link createAdminClient}. */
export interface AdminClientOptions {
  /** Base URL of the running Decoy server, e.g. `http://localhost:4001`. */
  baseUrl: string
  /** Admin path prefix; defaults to `/admin` (matches the server default). */
  prefix?: string
  /**
   * Session id stamped as `x-mock-session` on every **control** call, scoping it
   * to that session (ADR-0011). Omit for the global (dev) session. Session
   * lifecycle calls (`createSession`/`destroySession`) never carry it.
   */
  sessionId?: string
  /** Injectable `fetch` (defaults to the global). */
  fetch?: typeof fetch
}

/**
 * A typed client for the HTTP `/admin` control API (ADR-0010) — the cross-process
 * mirror of the canonical JS control API. Control methods resolve with the
 * resulting selection so a switch is confirmable; an unknown collection/route/
 * preset/variant or bad input fails loud with the server's error message,
 * mirroring the in-process API.
 */
export interface AdminClient {
  /** Read the current selection. */
  getSelection(): Promise<Selection>
  /** Switch the active collection. Rejects if `name` is not defined. */
  useCollection(name: string): Promise<Selection>
  /** Pin a single route's `preset` slot to `variant`. Rejects on an unknown address. */
  useRoute(route: string, preset: string, variant: string): Promise<Selection>
  /** Drop all per-route overrides. */
  reset(): Promise<Selection>
  /** Create an isolated session; resolves with its id. */
  createSession(): Promise<string>
  /** Destroy a session; resolves `true` if it existed, `false` for an unknown id. */
  destroySession(id: string): Promise<boolean>
}

interface RequestOptions {
  body?: unknown
  session?: string
}

/** Create an {@link AdminClient} bound to a running server's `/admin` API. */
export function createAdminClient(options: AdminClientOptions): AdminClient {
  const fetchImpl = options.fetch ?? fetch
  const prefix = options.prefix ?? '/admin'
  const base = `${options.baseUrl}${prefix}`
  const { sessionId } = options

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

  async function selectionFrom(res: Response): Promise<Selection> {
    const payload = await res.json().catch(() => undefined)
    if (!res.ok) {
      const message =
        (payload as { error?: string } | undefined)?.error ?? `admin: HTTP ${res.status}`
      throw new Error(message)
    }
    return payload as Selection
  }

  return {
    async getSelection() {
      return selectionFrom(await request('GET', '/selection', { session: sessionId }))
    },
    async useCollection(name) {
      return selectionFrom(
        await request('POST', '/collection', { body: { name }, session: sessionId }),
      )
    },
    async useRoute(route, preset, variant) {
      return selectionFrom(
        await request('POST', '/route', { body: { route, preset, variant }, session: sessionId }),
      )
    },
    async reset() {
      return selectionFrom(await request('POST', '/reset', { session: sessionId }))
    },
    async createSession() {
      const res = await request('POST', '/sessions')
      const payload = await res.json().catch(() => undefined)
      if (!res.ok) {
        const message =
          (payload as { error?: string } | undefined)?.error ?? `admin: HTTP ${res.status}`
        throw new Error(message)
      }
      return (payload as { id: string }).id
    },
    async destroySession(id) {
      const res = await request('DELETE', `/sessions/${encodeURIComponent(id)}`)
      if (res.status === 404) {
        return false
      }
      if (!res.ok) {
        const payload = (await res.json().catch(() => undefined)) as { error?: string } | undefined
        throw new Error(payload?.error ?? `admin: HTTP ${res.status}`)
      }
      return true
    },
  }
}
