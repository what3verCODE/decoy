import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  type Definitions,
  type MatchResult,
  type Preset,
  type RequestEnvelope,
  resolveCollection,
  type Variant,
} from '@decoy/core'
import { envelopeFrom } from './envelope'
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

/** A route's full detail — its presets and variants — served by `GET {prefix}/routes/{id}`. */
export interface RouteDetail {
  id: string
  method: string
  path: string
  presets: Record<string, Preset>
  variants: Record<string, Variant>
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

/** One collections-catalog entry: a scenario's identity, whether it's active, and its size. */
export interface CollectionCatalogEntry {
  name: string
  /** The parent collection this one `extends`, if any. */
  extends?: string
  /** True for the collection the controlling session currently has active. */
  active: boolean
  /** Number of resolved `route:preset:variant` entries (post-`extends`). */
  entryCount: number
}

/**
 * Summarize the definitions' collections into the catalog served by
 * `GET {prefix}/collections`, marking the session's `active` collection and
 * counting each scenario's resolved (post-`extends`) entries.
 */
function collectionsCatalog(definitions: Definitions, active: string): CollectionCatalogEntry[] {
  return [...definitions.collections.values()].map((collection) => ({
    name: collection.id,
    ...(collection.extends ? { extends: collection.extends } : {}),
    active: collection.id === active,
    entryCount: resolveCollection(definitions, collection.id).length,
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

/**
 * The request-resolution context the `POST {prefix}/try` dry-run needs to report a
 * miss/passthrough honestly and reproduce the live response byte-for-byte: the
 * fail-closed status and the global passthrough target (if configured). Mirrors
 * the live request handler's fail-closed/passthrough decision (DESIGN §6).
 */
export interface RequestResolution {
  /** The fail-closed status returned on a miss (mirrors the live server's `missStatus`). */
  missStatus: number
  /** The global passthrough target, if configured; a dry-run reports it but never forwards. */
  passthrough?: { url: string }
}

/** The body of `POST {prefix}/try`: a dry-run resolution plus the response it would serve. */
interface TryOutcome {
  /** `route:preset:variant` · `MISS(reason)` · `PASSTHROUGH(target)` — mirrors the log line. */
  resolution: string
  /** The response the live server would serve, or `null` for a passthrough (not forwarded). */
  response: { status: number; headers: Record<string, string>; body: unknown } | null
}

/**
 * Build the request envelope for a `POST {prefix}/try` dry-run from its JSON body
 * (`{ method, url|path, query, headers, body }`), routing it through the same
 * {@link envelopeFrom} the live server uses so the engine sees an identical shape.
 * A `body` is re-serialized as JSON (the live transport's wire form) so partial
 * `body` matchers behave exactly as on a real request.
 */
function tryEnvelope(input: Record<string, unknown>): RequestEnvelope {
  const method = typeof input.method === 'string' ? input.method : 'GET'

  const headers: Record<string, string> = {}
  if (input.headers !== null && typeof input.headers === 'object') {
    for (const [name, value] of Object.entries(input.headers as Record<string, unknown>)) {
      if (typeof value === 'string') {
        headers[name.toLowerCase()] = value
      }
    }
  }

  let url: string
  if (typeof input.url === 'string') {
    url = input.url
  } else {
    const path = typeof input.path === 'string' ? input.path : '/'
    const params = new URLSearchParams()
    if (input.query !== null && typeof input.query === 'object') {
      for (const [key, value] of Object.entries(input.query as Record<string, unknown>)) {
        if (Array.isArray(value)) {
          for (const item of value) {
            params.append(key, String(item))
          }
        } else if (value !== undefined && value !== null) {
          params.append(key, String(value))
        }
      }
    }
    const queryString = params.toString()
    url = queryString ? `${path}?${queryString}` : path
  }

  let rawBody: Buffer | undefined
  if (input.body !== undefined) {
    rawBody = Buffer.from(JSON.stringify(input.body))
    if (!('content-type' in headers)) {
      headers['content-type'] = 'application/json'
    }
  }

  return envelopeFrom({ method, url, headers } as unknown as IncomingMessage, rawBody)
}

/**
 * Resolve a dry-run {@link MatchResult} into the `POST {prefix}/try` body: the
 * `route:preset:variant` address and its response on a match; otherwise the live
 * server's branch — `PASSTHROUGH(target)` with no forwarded response when
 * passthrough is on, else the byte-identical fail-closed `MISS(reason)` response.
 */
function tryOutcome(result: MatchResult, resolution: RequestResolution): TryOutcome {
  if (result.type === 'matched') {
    const { route, preset, variant } = result.address
    return { resolution: `${route}:${preset}:${variant}`, response: result.response }
  }
  if (resolution.passthrough) {
    return { resolution: `PASSTHROUGH(${resolution.passthrough.url})`, response: null }
  }
  return {
    resolution: `MISS(${result.reason.kind})`,
    response: {
      status: resolution.missStatus,
      headers: { 'x-mock-miss': 'true', 'content-type': 'application/json' },
      body: { error: result.message },
    },
  }
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
 * - `GET  {prefix}/routes/{id}`                         → a route's presets+variants in full (pure read).
 * - `GET  {prefix}/collections`                         → collections catalog, active marked (pure read).
 * - `GET  {prefix}/collections/{name}`                  → a collection's resolved entries (pure read).
 * - `GET  {prefix}/logs`                                → SSE live request stream.
 * - `POST {prefix}/try`                                 → dry-run match (resolution + response, zero side effects).
 * - `GET  {prefix}/sessions`                            → list sessions (global + created) with their selection (pure read).
 * - `GET  {prefix}/sessions/{id}/logs`                  → a session's request timeline, ordered across services (survives destroy).
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
  resolution: RequestResolution,
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

    if (method === 'GET' && sub.startsWith('/routes/')) {
      const id = decodeURIComponent(sub.slice('/routes/'.length))
      const route = definitions.routes.get(id)
      if (!route) {
        sendJson(res, 404, { error: `admin: no such route "${id}"` })
        return
      }
      const detail: RouteDetail = {
        id: route.id,
        method: route.method,
        path: route.path,
        presets: route.presets,
        variants: route.variants,
      }
      sendJson(res, 200, detail)
      return
    }

    if (method === 'GET' && sub === '/collections') {
      sendJson(res, 200, collectionsCatalog(definitions, control.selection.collection))
      return
    }

    if (method === 'GET' && sub.startsWith('/collections/')) {
      const name = decodeURIComponent(sub.slice('/collections/'.length))
      const collection = definitions.collections.get(name)
      if (!collection) {
        sendJson(res, 404, { error: `admin: no such collection "${name}"` })
        return
      }
      sendJson(res, 200, {
        name: collection.id,
        ...(collection.extends ? { extends: collection.extends } : {}),
        active: collection.id === control.selection.collection,
        entries: resolveCollection(definitions, name),
      })
      return
    }

    if (method === 'GET' && sub === '/logs') {
      serveLogStream(req, res, store)
      return
    }

    if (method === 'GET' && sub === '/sessions') {
      sendJson(res, 200, sessions.list())
      return
    }

    if (method === 'GET' && sub.startsWith('/sessions/') && sub.endsWith('/logs')) {
      // The session's request timeline, ordered across all services (one timeline).
      // Read from the store — *not* the session registry — so it survives the
      // session's destruction (logs are decoupled from session lifecycle, ADR-0017),
      // except under sqlite `cleanup: 'on-session-end'` which already dropped them.
      const id = decodeURIComponent(sub.slice('/sessions/'.length, -'/logs'.length))
      sendJson(res, 200, store.query({ session: id }))
      return
    }

    if (method === 'POST') {
      const body = (await readJsonBody(req)) as Record<string, unknown> | undefined

      if (sub === '/try') {
        // A pure dry-run: run the real engine against the caller's selection and
        // report the resolution + response. No `record()` call → zero side effects,
        // excluded from the request-log store / live stream (ADR-0017).
        const result = control.match(tryEnvelope(body ?? {}))
        sendJson(res, 200, tryOutcome(result, resolution))
        return
      }

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
