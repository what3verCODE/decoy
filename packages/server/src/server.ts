import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http'
import type { LoadedService } from '@decoy/config'
import type { Controller, Definitions, MockResponse } from '@decoy/core'
import { handleControl, isUnderPrefix, type RequestResolution } from './control'
import { envelopeFrom, readRawBody } from './envelope'
import { consoleLogger, type Logger, type RequestLog } from './logger'
import { forwardPassthrough } from './passthrough'
import {
  createRequestLogStore,
  type RequestLogStore,
  type SharedRequestLogStore,
} from './request-log-store'
import { createSessionRegistry, GLOBAL_SESSION } from './sessions'
import { type Scheduler, type Watcher, type WatchFn, watchSources } from './watch'

/**
 * Dev-only hot reload wiring (#44). When present, the server watches
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
  /**
   * A shared request-log store to record into instead of one created from this
   * service's `requestLog` config. The multi-instance aggregator (#72)
   * injects **one shared store** across every instance so the `--ui` server's logs
   * view aggregates across services (each record tagged by `service`). The server
   * {@link SharedRequestLogStore.acquire}s a holder handle and closes it on shutdown
   * like any store; the shared store itself closes only when every instance's handle
   * has closed (close-once ownership, #80). Omitted → the server creates and owns its
   * own store from config (the single-instance default).
   */
  requestLog?: SharedRequestLogStore
}

export interface DecoyServer {
  /**
   * The service (instance) name this server impersonates. Exposed so the
   * in-process `--ui` aggregator (#72) can list services and route a `?service=`
   * control request to the right instance.
   */
  readonly name: string
  /** Start listening; resolves with the actual bound port (useful with port 0). */
  listen(): Promise<number>
  /** Stop listening. */
  close(): Promise<void>
  /**
   * The canonical JS control API driving this server in-process (the HTTP control
   * API mirrors it). This is the **global** session — what no-header requests
   * resolve against.
   */
  readonly control: Controller
  /** The immutable definitions this server matches against (routes + collections). */
  readonly definitions: Definitions
  /**
   * Serve a control-API request against **this** instance: the same
   * handler the cross-process mount uses, exposed in-process so the `--ui`
   * aggregator can route a `?service=`-selected request here with no
   * HTTP proxy or CORS. Closes over this instance's own sessions, definitions,
   * request-log store, and fail-closed/passthrough resolution, and turns an
   * unexpected handler failure into a `500` — so neither mount repeats that.
   * Works regardless of the `control.enabled` flag (which governs only whether
   * the instance's *own* port routes to it).
   */
  serveControl(req: IncomingMessage, res: ServerResponse): void
  /**
   * The port the HTTP control API is reachable on once listening: the service port
   * (same-port mount) or its dedicated port; `undefined` when control is disabled
   * or before `listen()`.
   */
  readonly controlPort: number | undefined
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
  // The request-log store this instance records to (memory or durable sqlite, #70).
  // A shared store (the aggregator's, #72) hands out a per-instance holder handle;
  // otherwise the server creates its own from config. Either way it is closed the
  // same way on shutdown — the handle's close is ref-counted so the shared store
  // closes once, after the last instance (#80), with no `ownsStore` flag.
  const requestLog: RequestLogStore = options.requestLog
    ? options.requestLog.acquire()
    : createRequestLogStore(service.requestLog)
  const sessions = createSessionRegistry(service.definitions, service.defaultCollection, {
    idleTtlMs: service.sessionIdleTtlMs,
    onReap: (ids) => {
      // A reaped session is destroyed — let the store apply its cleanup policy.
      for (const id of ids) {
        requestLog.endSession(id)
      }
      logger.info(`decoy "${service.name}" reaped ${ids.length} idle session(s)`)
    },
    onDestroy: (id) => requestLog.endSession(id),
  })
  const missStatus = service.missStatus
  const passthrough = service.passthrough
  const controlMount = service.control
  const samePortControl = controlMount.enabled && controlMount.port === undefined
  // The fail-closed/passthrough context the `{prefix}/try` dry-run replays.
  const resolution: RequestResolution = { missStatus, passthrough }

  // Serve a control-API request against this instance, closing over this
  // instance's own sessions/definitions/store/resolution. The same handler backs the
  // cross-process mount and the in-process `--ui` aggregator; it absorbs
  // an unexpected handler failure into a 500 so neither mount repeats that try/catch.
  const serveControl = (req: IncomingMessage, res: ServerResponse): void => {
    void handleControl(
      req,
      res,
      sessions,
      controlMount.prefix,
      logger,
      service.definitions,
      requestLog,
      resolution,
    ).catch((error: unknown) => {
      res.statusCode = 500
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ error: 'internal decoy error' }))
      logger.warn(
        `control request failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    })
  }

  // Record one structured line per request to both the logger (stdout) and the log
  // store (the `GET /__decoy__/logs` SSE stream); the store tags each with this service.
  const record = (log: RequestLog): void => {
    logger.request(log)
    requestLog.append({ ...log, service: service.name })
  }

  const raw = createHttpServer((req, res) => {
    if (samePortControl && isUnderPrefix(req.url, controlMount.prefix)) {
      serveControl(req, res)
      return
    }

    const sessionHeader = req.headers['x-mock-session']
    const sessionId = Array.isArray(sessionHeader) ? sessionHeader[0] : sessionHeader
    const control = sessions.resolve(sessionId)
    // The resolved session label: 'global' for no/empty header (matching resolve).
    const session = sessionId ? sessionId : GLOBAL_SESSION
    const start = process.hrtime.bigint()
    const elapsedMs = () => Number(process.hrtime.bigint() - start) / 1e6
    void readRawBody(req)
      .then(async (rawBody) => {
        const envelope = envelopeFrom(req, rawBody)
        const result = control.match(envelope)

        if (result.type === 'matched') {
          writeResponse(res, result.response)
          record({
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
          record({
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
        record({
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

  // A dedicated control port (the escape hatch for mocking a `/__decoy__/*` upstream)
  // gets its own HTTP server; otherwise control rides the main server above.
  const controlServer =
    controlMount.enabled && controlMount.port !== undefined
      ? createHttpServer((req, res) => serveControl(req, res))
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
  let boundControlPort: number | undefined

  return {
    raw,
    name: service.name,
    control: sessions.global,
    definitions: service.definitions,
    serveControl,
    get controlPort() {
      if (!controlMount.enabled) {
        return undefined
      }
      return controlServer ? boundControlPort : boundPort
    },
    async listen() {
      boundPort = await listenOn(raw, service.port)
      logger.info(`decoy "${service.name}" listening on http://localhost:${boundPort}`)
      if (controlServer && controlMount.port !== undefined) {
        boundControlPort = await listenOn(controlServer, controlMount.port)
        logger.info(
          `decoy "${service.name}" control API on http://localhost:${boundControlPort}${controlMount.prefix}`,
        )
      }
      return boundPort
    },
    async close() {
      watcher?.close()
      sessions.stop()
      if (controlServer) {
        await closeServer(controlServer)
      }
      await closeServer(raw)
      // Release the store last. For an own store this removes the file under sqlite
      // `cleanup: 'on-exit'`; for a shared holder handle it releases this instance's
      // reference, and the shared store closes once after the last instance (#80).
      requestLog.close()
    },
  }
}
