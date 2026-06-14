import { createServer as createHttpServer, type Server, type ServerResponse } from 'node:http'
import type { LoadedService } from '@decoy/config'
import { createEngine, type MockResponse, type Selection } from '@decoy/core'
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
  /** The underlying Node server. */
  readonly raw: Server
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
  const engine = createEngine(service.definitions)
  const selection: Selection = { collection: service.defaultCollection }

  const raw = createHttpServer((req, res) => {
    const start = process.hrtime.bigint()
    void toEnvelope(req)
      .then((envelope) => {
        const result = engine.match(envelope, selection)
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

  return {
    raw,
    listen() {
      return new Promise<number>((resolvePort, reject) => {
        const onError = (error: Error) => reject(error)
        raw.once('error', onError)
        raw.listen(service.port, () => {
          raw.removeListener('error', onError)
          const address = raw.address()
          const port = typeof address === 'object' && address ? address.port : service.port
          logger.info(`decoy "${service.name}" listening on http://localhost:${port}`)
          resolvePort(port)
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
