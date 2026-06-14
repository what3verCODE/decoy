import type { LoadedService } from '@decoy/config'
import type { Collection, Route } from '@decoy/core'
import { createServer, type DecoyServer, type Logger } from '@decoy/server'

const silent: Logger = { info() {}, warn() {}, request() {} }

const usersRoute: Route = {
  id: 'users-by-id',
  method: 'GET',
  path: '/users/{id}',
  presets: { default: {} },
  variants: {
    success: { status: 200, body: { id: 42, name: 'Ada' } },
    error: { status: 500, body: { error: 'boom' } },
  },
}

const happyPath: Collection = { id: 'happy-path', routes: ['users-by-id:default:success'] }
const errorState: Collection = { id: 'error-state', routes: ['users-by-id:default:error'] }

function service(): LoadedService {
  return {
    name: 'users',
    port: 0,
    defaultCollection: 'happy-path',
    missStatus: 501,
    admin: { enabled: true, prefix: '/admin' },
    sessionIdleTtlMs: 1_800_000,
    definitions: {
      routes: new Map([[usersRoute.id, usersRoute]]),
      collections: new Map([
        [happyPath.id, happyPath],
        [errorState.id, errorState],
      ]),
    },
  }
}

/** A live Decoy server plus its base URL — the real transport SessionRouter drives. */
export interface TestServer {
  server: DecoyServer
  base: string
  /** Fetch `/users/42` as the named session (omit header for the global session). */
  user(sessionId?: string): Promise<Response>
  stop(): Promise<void>
}

/** Boot a real Decoy server on an ephemeral port for the control-SDK integration tests. */
export async function startTestServer(): Promise<TestServer> {
  const server = createServer(service(), { logger: silent })
  const port = await server.listen()
  const base = `http://localhost:${port}`
  return {
    server,
    base,
    user(sessionId) {
      const headers = sessionId ? { 'x-mock-session': sessionId } : undefined
      return fetch(`${base}/users/42`, { headers })
    },
    async stop() {
      await server.close()
    },
  }
}
