import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http'
import type { LoadedService } from '@decoy/config'
import type { Controller, Definitions, MockResponse } from '@decoy/core'
import { handleAdmin, isAdminPath } from './admin'
import { envelopeFrom, readRawBody } from './envelope'
import { consoleLogger, type Logger } from './logger'
import { forwardPassthrough } from './passthrough'
import { createSessionRegistry, type SessionRegistry } from './sessions'
import { type Scheduler, type Watcher, type WatchFn, watchSources } from './watch'

/**
 * Dev-only hot reload wiring (#44, DESIGN §11). When present, the server watches
 * `paths` and re-loads the service via `reload` on change, swapping the live
 * definitions atomically (an invalid config is rejected and the old definitions
 * kept). Omitted in CI/e2e so definitions stay frozen.
 */
export interface WatchSetup {
  /** Filesystem paths (files or dirs) to watch for changes. */
  paths: string[]
  /** Re-load the service from disk; rejects (e.g. `ValidationError`) on an invalid config. */
  reload: () => Promise<LoadedService>
  /** Debounce window (ms) coalescing rapid file events into one reload. */
  debounceMs?: number
  /** Injectable fs watcher (defaults to a recursive `node:fs` watcher). */
  watch?: WatchFn
  /** Injectable debounce scheduler (defaults to an `unref`'d `setTimeout`). */
  scheduler?: Scheduler
}

export interface CreateServerOptions {
  logger?: Logger
  /** Enable dev-only hot reload (#44). Omit in CI/e2e to keep definitions frozen. */
  watch?: WatchSetup
}

export interface DecoyServer {
  /** Start listening; resolves with the actual bound port (useful with port 0). */
  listen(): Promise<number>
  /** Stop listening. */
  close(): Promise<void>
  /**
   * The canonical JS control API driving this server in-process (`/admin` mirrors
   * it). This is the **global** session — what no-header requests resolve against.
   */
  readonly control: Controller
  /**
   * The session registry backing this server — the global session plus any
   * created ones. Exposed so an in-process `--ui` server (ADR-0017) can drive and
   * read this instance's selection directly, with no HTTP proxy or CORS.
   */
  readonly sessions: SessionRegistry
  /** The immutable definitions this server matches against (routes + collections). */
  readonly definitions: Definitions
  /**
   * The port the HTTP `/admin` control API is reachable on once listening: the
   * service port (same-port mount) or its dedicated port; `undefined` when admin
   * is disabled or before `listen()`.
   */
  readonly adminPort: number | undefined
  /** The underlying Node server. */
  readonly raw: Server
}

function listenOn(server: Server, port: number): Promise<number> {
  return new Promise<number>((resolvePort, reject) => {
    const onError = (error: Error) => reject(error)
    server.once('error', onError)
    server.listen(port, () => {
      server.removeListener('error', onError)
      const address = server.address()
      resolvePort(typeof address === 'object' && address ? address.port : port)
    })
  })
}

function closeServer(server: Server): Promise<void> {
  return new Promise<void>((resolveClose, reject) => {
    server.close((error) => (error ? reject(error) : resolveClose()))
  })
}

/** Dispatch an admin request, turning an unexpected handler failure into a 500. */
function serveAdmin(
  req: IncomingMessage,
  res: ServerResponse,
  sessions: SessionRegistry,
  prefix: string,
  logger: Logger,
  definitions: Definitions,
): void {
  void handleAdmin(req, res, sessions, prefix, logger, definitions).catch((error: unknown) => {
    res.statusCode = 500
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ error: 'internal decoy error' }))
    logger.warn(`admin request failed: ${error instanceof Error ? error.message : String(error)}`)
  })
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const lower = name.toLowerCase()
  return Object.keys(headers).some((key) => key.toLowerCase() === lower)
}

function writeResponse(res: ServerResponse, response: MockResponse): void {
  res.statusCode = response.status
  for (const [key, value] of Object.entries(response.headers)) {
    res.setHeader(key, value)
  }

  const body = response.body
  if (body === undefined || body === null) {
    res.end()
    return
  }
  if (typeof body === 'string') {
    res.end(body)
    return
  }
  if (!hasHeader(response.headers, 'content-type')) {
    res.setHeader('content-type', 'application/json')
  }
  res.end(JSON.stringify(body))
}

function writeMiss(res: ServerResponse, message: string, status: number): void {
  res.statusCode = status
  res.setHeader('x-mock-miss', 'true')
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify({ error: message }))
}

/**
 * Create an HTTP server that serves matched variants from the pure engine and
 * fails closed (`501` + `x-mock-miss`) on a miss. One structured log line is
 * emitted per request.
 */
export function createServer(
  service: LoadedService,
  options: CreateServerOptions = {},
): DecoyServer {
  const logger = options.logger ?? consoleLogger
  const sessions = createSessionRegistry(service.definitions, service.defaultCollection, {
    idleTtlMs: service.sessionIdleTtlMs,
    onReap: (ids) => logger.info(`decoy "${service.name}" reaped ${ids.length} idle session(s)`),
  })
  const missStatus = service.missStatus
  const passthrough = service.passthrough
  const admin = service.admin
  const samePortAdmin = admin.enabled && admin.port === undefined

  const raw = createHttpServer((req, res) => {
    if (samePortAdmin && isAdminPath(req.url, admin.prefix)) {
      serveAdmin(req, res, sessions, admin.prefix, logger, service.definitions)
      return
    }

    const sessionHeader = req.headers['x-mock-session']
    const sessionId = Array.isArray(sessionHeader) ? sessionHeader[0] : sessionHeader
    const control = sessions.resolve(sessionId)
    // The resolved session label: 'global' for no/empty header (matching resolve).
    const session = sessionId ? sessionId : 'global'
    const start = process.hrtime.bigint()
    const elapsedMs = () => Number(process.hrtime.bigint() - start) / 1e6
    void readRawBody(req)
      .then(async (rawBody) => {
        const envelope = envelopeFrom(req, rawBody)
        const result = control.match(envelope)

        if (result.type === 'matched') {
          writeResponse(res, result.response)
          logger.request({
            method: envelope.method,
            path: envelope.path,
            outcome: { type: 'matched', address: result.address },
            status: result.response.status,
            latencyMs: elapsedMs(),
            session,
          })
          return
        }

        // No match: forward to the passthrough upstream if configured, else fail closed.
        if (passthrough) {
          const status = await forwardPassthrough(req, res, rawBody, passthrough.url)
          logger.request({
            method: envelope.method,
            path: envelope.path,
            outcome: { type: 'passthrough', target: passthrough.url },
            status,
            latencyMs: elapsedMs(),
            session,
          })
          return
        }

        writeMiss(res, result.message, missStatus)
        logger.request({
          method: envelope.method,
          path: envelope.path,
          outcome: { type: 'miss', reason: result.reason.kind },
          status: missStatus,
          latencyMs: elapsedMs(),
          session,
        })
      })
      .catch((error: unknown) => {
        res.statusCode = 500
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ error: 'internal decoy error' }))
        logger.warn(`request failed: ${error instanceof Error ? error.message : String(error)}`)
      })
  })

  // A dedicated admin port (the escape hatch for mocking an `/admin/*` upstream)
  // gets its own HTTP server; otherwise admin rides the main server above.
  const adminServer =
    admin.enabled && admin.port !== undefined
      ? createHttpServer((req, res) =>
          serveAdmin(req, res, sessions, admin.prefix, logger, service.definitions),
        )
      : undefined

  // Dev-only hot reload (#44): re-load the service on a watched-source change and
  // swap every session's definitions atomically. Off (undefined) in CI/e2e.
  const watcher: Watcher | undefined = options.watch
    ? watchSources({
        paths: options.watch.paths,
        reload: options.watch.reload,
        debounceMs: options.watch.debounceMs,
        watch: options.watch.watch,
        scheduler: options.watch.scheduler,
        onReload: (next) => {
          const results = sessions.reload(next.definitions, next.defaultCollection)
          for (const result of results) {
            if (result.collectionFellBack) {
              logger.warn(
                `decoy "${service.name}" hot reload: session "${result.session}" collection vanished — fell back to "${result.collection}"`,
              )
            }
            if (result.droppedOverrides.length > 0) {
              logger.warn(
                `decoy "${service.name}" hot reload: session "${result.session}" dropped ${result.droppedOverrides.length} stale override(s)`,
              )
            }
          }
          logger.info(`decoy "${service.name}" hot reloaded definitions`)
        },
        onError: (error) => {
          logger.warn(
            `decoy "${service.name}" hot reload failed: ${
              error instanceof Error ? error.message : String(error)
            } — keeping current definitions`,
          )
        },
      })
    : undefined

  let boundPort: number | undefined
  let boundAdminPort: number | undefined

  return {
    raw,
    control: sessions.global,
    sessions,
    definitions: service.definitions,
    get adminPort() {
      if (!admin.enabled) {
        return undefined
      }
      return adminServer ? boundAdminPort : boundPort
    },
    async listen() {
      boundPort = await listenOn(raw, service.port)
      logger.info(`decoy "${service.name}" listening on http://localhost:${boundPort}`)
      if (adminServer && admin.port !== undefined) {
        boundAdminPort = await listenOn(adminServer, admin.port)
        logger.info(
          `decoy "${service.name}" admin API on http://localhost:${boundAdminPort}${admin.prefix}`,
        )
      }
      return boundPort
    },
    async close() {
      watcher?.close()
      sessions.stop()
      if (adminServer) {
        await closeServer(adminServer)
      }
      await closeServer(raw)
    },
  }
}
