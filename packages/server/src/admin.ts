import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Definitions } from '@decoy/core'
import type { Logger } from './logger'
import type { RequestLogStore, StoredRequestLog } from './request-log-store'
import type { SessionRegistry } from './sessions'

/** Heartbeat interval (ms) keeping an idle SSE connection alive through proxies. */
const SSE_HEARTBEAT_MS = 15_000

/** One routes-catalog entry: a route's identity plus how many presets/variants it carries. */
export interface RouteCatalogEntry {
  id: string
  method: string
  path: string
  presetCount: number
  variantCount: number
}

/** Summarize the definitions' routes into the catalog served by `GET {prefix}/routes`. */
function routesCatalog(definitions: Definitions): RouteCatalogEntry[] {
  return [...definitions.routes.values()].map((route) => ({
    id: route.id,
    method: route.method,
    path: route.path,
    presetCount: Object.keys(route.presets).length,
    variantCount: Object.keys(route.variants).length,
  }))
}

/** The `x-mock-session` header value, if present (first value wins for a repeated header). */
function sessionIdOf(req: IncomingMessage): string | undefined {
  const value = req.headers['x-mock-session']
  return Array.isArray(value) ? value[0] : value
}

/** Path of a request, ignoring the query string. */
function pathOf(url: string | undefined): string {
  return new URL(url ?? '/', 'http://localhost').pathname
}

/** True when the request path is the admin `prefix` itself or a sub-path of it. */
export function isAdminPath(url: string | undefined, prefix: string): boolean {
  const path = pathOf(url)
  return path === prefix || path.startsWith(`${prefix}/`)
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(body))
}

/**
 * Stream the request log as Server-Sent Events (ADR-0017): replay the retained
 * history on connect, then tail every newly appended record one-way (control
 * stays REST — no WebSocket dep). Each frame carries the stored `seq` as the SSE
 * `id:`, so a client can dedupe re-delivered history after a reconnect. Snapshot
 * and subscribe happen with no `await` between them, so no record is dropped or
 * duplicated across the replay/tail boundary.
 */
function serveLogStream(req: IncomingMessage, res: ServerResponse, store: RequestLogStore): void {
  res.statusCode = 200
  res.setHeader('content-type', 'text/event-stream')
  res.setHeader('cache-control', 'no-cache, no-transform')
  res.setHeader('connection', 'keep-alive')
  // Disable proxy buffering so events flush immediately (e.g. nginx).
  res.setHeader('x-accel-buffering', 'no')
  res.flushHeaders()

  const send = (record: StoredRequestLog): void => {
    res.write(`id: ${record.seq}\ndata: ${JSON.stringify(record)}\n\n`)
  }
  for (const record of store.snapshot()) {
    send(record)
  }
  const unsubscribe = store.subscribe(send)

  const heartbeat = setInterval(() => res.write(': ping\n\n'), SSE_HEARTBEAT_MS)
  heartbeat.unref()

  const close = (): void => {
    clearInterval(heartbeat)
    unsubscribe()
  }
  req.on('close', close)
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(chunk as Buffer)
  }
  if (chunks.length === 0) {
    return undefined
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new Error('admin: request body is not valid JSON')
  }
}

/**
 * Handle a request to the HTTP `/admin` control API (ADR-0010) — the cross-process
 * mirror of the canonical JS control API. Endpoints, relative to `prefix`:
 *
 * - `GET  {prefix}` / `GET {prefix}/selection` → the current selection.
 * - `POST {prefix}/collection` `{ name }`               → `setCollection(name)`.
 * - `POST {prefix}/route` `{ route, preset, variant }`  → `useRoute(...)`.
 * - `POST {prefix}/reset`                               → `reset()`.
 * - `GET  {prefix}/routes`                              → the routes catalog (pure read).
 * - `GET  {prefix}/logs`                                → SSE live request stream.
 * - `POST {prefix}/sessions`                            → create a session (`201` `{ id }`).
 * - `DELETE {prefix}/sessions/{id}`                     → destroy a session.
 *
 * Control endpoints are **session-scoped** by the `x-mock-session` header (ADR-0011):
 * with no header they target the global (dev) session; with one they target (and
 * lazily create) that session, isolating parallel tests on a shared server.
 *
 * Each mutating call returns the resulting selection (`200`), so a switch is
 * confirmable. Control mutations are atomic — the next mocked request sees the
 * new state. Bad input or an unknown collection/route/preset/variant is a `400`;
 * an unknown endpoint is a `404`.
 */
export async function handleAdmin(
  req: IncomingMessage,
  res: ServerResponse,
  sessions: SessionRegistry,
  prefix: string,
  logger: Logger,
  definitions: Definitions,
  store: RequestLogStore,
): Promise<void> {
  const method = req.method ?? 'GET'
  const path = pathOf(req.url)

  if (!isAdminPath(req.url, prefix)) {
    sendJson(res, 404, { error: `admin: no such endpoint ${method} ${path}` })
    return
  }
  const sub = path.slice(prefix.length) || '/'
  const sessionId = sessionIdOf(req)
  const control = sessions.resolve(sessionId)

  try {
    if (method === 'POST' && sub === '/sessions') {
      const id = sessions.create()
      logger.info(`admin: createSession ${id}`)
      sendJson(res, 201, { id })
      return
    }

    if (method === 'DELETE' && sub.startsWith('/sessions/')) {
      const id = decodeURIComponent(sub.slice('/sessions/'.length))
      if (!sessions.destroy(id)) {
        sendJson(res, 404, { error: `admin: no such session "${id}"` })
        return
      }
      logger.info(`admin: destroySession ${id}`)
      sendJson(res, 200, { destroyed: id })
      return
    }

    if (method === 'GET' && (sub === '/' || sub === '/selection')) {
      sendJson(res, 200, control.selection)
      return
    }

    if (method === 'GET' && sub === '/routes') {
      sendJson(res, 200, routesCatalog(definitions))
      return
    }

    if (method === 'GET' && sub === '/logs') {
      serveLogStream(req, res, store)
      return
    }

    if (method === 'POST') {
      const body = (await readJsonBody(req)) as Record<string, unknown> | undefined

      if (sub === '/collection') {
        const name = body?.name
        if (typeof name !== 'string') {
          sendJson(res, 400, { error: 'admin: "name" (string) is required' })
          return
        }
        control.setCollection(name)
        logger.info(`admin: setCollection ${name}`)
        sendJson(res, 200, control.selection)
        return
      }

      if (sub === '/route') {
        const route = body?.route
        const preset = body?.preset
        const variant = body?.variant
        if (
          typeof route !== 'string' ||
          typeof preset !== 'string' ||
          typeof variant !== 'string'
        ) {
          sendJson(res, 400, {
            error: 'admin: "route", "preset", and "variant" (strings) are required',
          })
          return
        }
        control.useRoute(route, preset, variant)
        logger.info(`admin: useRoute ${route}:${preset}:${variant}`)
        sendJson(res, 200, control.selection)
        return
      }

      if (sub === '/reset') {
        control.reset()
        logger.info('admin: reset')
        sendJson(res, 200, control.selection)
        return
      }
    }

    sendJson(res, 404, { error: `admin: no such endpoint ${method} ${path}` })
  } catch (error) {
    // Malformed body and unknown collection/route/preset/variant are caller errors.
    sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
  }
}
