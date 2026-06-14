import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http'
import type { LoadedService } from '@decoy/config'
import { type Controller, createController, type MockResponse } from '@decoy/core'
import { handleAdmin, isAdminPath } from './admin'
import { toEnvelope } from './envelope'
import { consoleLogger, type Logger } from './logger'

/** Status returned for a fail-closed miss. Made configurable in #26. */
const MISS_STATUS = 501

export interface CreateServerOptions {
  logger?: Logger
}

export interface DecoyServer {
  /** Start listening; resolves with the actual bound port (useful with port 0). */
  listen(): Promise<number>
  /** Stop listening. */
  close(): Promise<void>
  /** The canonical JS control API driving this server in-process (`/admin` mirrors it). */
  readonly control: Controller
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
  control: Controller,
  prefix: string,
  logger: Logger,
): void {
  void handleAdmin(req, res, control, prefix, logger).catch((error: unknown) => {
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

function writeMiss(res: ServerResponse, message: string): void {
  res.statusCode = MISS_STATUS
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
  const control = createController(service.definitions, service.defaultCollection)
  const admin = service.admin
  const samePortAdmin = admin.enabled && admin.port === undefined

  const raw = createHttpServer((req, res) => {
    if (samePortAdmin && isAdminPath(req.url, admin.prefix)) {
      serveAdmin(req, res, control, admin.prefix, logger)
      return
    }

    const start = process.hrtime.bigint()
    void toEnvelope(req)
      .then((envelope) => {
        const result = control.match(envelope)
        const latencyMs = Number(process.hrtime.bigint() - start) / 1e6
        const elapsed = latencyMs.toFixed(1)

        if (result.type === 'matched') {
          writeResponse(res, result.response)
          const { route, preset, variant } = result.address
          logger.info(
            `${envelope.method} ${envelope.path} → ${route}:${preset}:${variant} ${result.response.status} ${elapsed}ms`,
          )
        } else {
          writeMiss(res, result.message)
          logger.warn(
            `${envelope.method} ${envelope.path} → MISS(${result.reason.kind}) ${MISS_STATUS} ${elapsed}ms`,
          )
        }
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
      ? createHttpServer((req, res) => serveAdmin(req, res, control, admin.prefix, logger))
      : undefined

  let boundPort: number | undefined
  let boundAdminPort: number | undefined

  return {
    raw,
    control,
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
      if (adminServer) {
        await closeServer(adminServer)
      }
      await closeServer(raw)
    },
  }
}
