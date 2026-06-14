import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

/** Configuration for the example BFF app. */
export interface AppOptions {
  /**
   * Base URL of the upstream users API. In the dogfood setup this points at a
   * Decoy instance, so the app develops against deterministic mocks instead of a
   * real backend.
   */
  apiBaseUrl: string
}

/** A running instance of the example app. */
export interface PlaygroundApp {
  /** Start listening; resolves with the actual bound port (pass 0 for ephemeral). */
  listen(port?: number): Promise<number>
  /** Stop listening. */
  close(): Promise<void>
  /** The underlying Node server. */
  readonly raw: Server
}

interface UpstreamUser {
  id: number
  name: string
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(body))
}

/**
 * Read the upstream response and surface it as a BFF would: an OK user becomes a
 * greeting; any non-OK upstream status is reported as a `502` carrying the
 * upstream status and whether it was a fail-closed Decoy miss (`x-mock-miss`).
 */
async function relayUpstream(
  res: ServerResponse,
  upstream: Response,
  shape: (user: UpstreamUser) => unknown,
): Promise<void> {
  if (!upstream.ok) {
    sendJson(res, 502, {
      error: 'upstream unavailable',
      upstreamStatus: upstream.status,
      mockMiss: upstream.headers.get('x-mock-miss') === 'true',
    })
    return
  }
  const user = (await upstream.json()) as UpstreamUser
  sendJson(res, 200, shape(user))
}

/**
 * Create the example app: a thin BFF that calls the upstream users API
 * (`apiBaseUrl`) and transforms the result. Pointing `apiBaseUrl` at a Decoy
 * instance fakes the **browser → API** edge without touching app code.
 */
export function createApp(options: AppOptions): PlaygroundApp {
  const base = options.apiBaseUrl.replace(/\/+$/, '')

  const raw = createServer((req: IncomingMessage, res: ServerResponse) => {
    const path = (req.url ?? '/').split('?')[0]

    if (req.method === 'GET' && path === '/health') {
      sendJson(res, 200, { ok: true })
      return
    }

    if (req.method === 'GET' && path === '/profile') {
      void fetch(`${base}/users/42`)
        .then((upstream) =>
          relayUpstream(res, upstream, (user) => ({
            greeting: `Hello, ${user.name}!`,
            userId: user.id,
          })),
        )
        .catch(() => sendJson(res, 502, { error: 'upstream unreachable' }))
      return
    }

    // No route is mocked for /orders upstream — exercises a fail-closed miss
    // flowing all the way back through the running stack.
    if (req.method === 'GET' && path === '/orders') {
      void fetch(`${base}/orders`)
        .then((upstream) => relayUpstream(res, upstream, (user) => ({ order: user })))
        .catch(() => sendJson(res, 502, { error: 'upstream unreachable' }))
      return
    }

    sendJson(res, 404, { error: `no app route for ${req.method} ${path}` })
  })

  return {
    raw,
    listen(port = 0) {
      return new Promise<number>((resolvePort, reject) => {
        const onError = (error: Error) => reject(error)
        raw.once('error', onError)
        raw.listen(port, () => {
          raw.removeListener('error', onError)
          const address = raw.address()
          resolvePort(typeof address === 'object' && address ? address.port : port)
        })
      })
    },
    close() {
      return new Promise<void>((resolveClose, reject) => {
        raw.close((error) => (error ? reject(error) : resolveClose()))
      })
    },
  }
}
