// The data API the SPA fetches from its own (loopback) origin — same origin as the
// served assets, so no CORS (ADR-0017). Mirrors the server's RouteCatalogEntry.

/** Append the active `?service=` selector to a control/catalog URL (omitted when unset). */
function scoped(url: string, service: string | null): string {
  if (!service) {
    return url
  }
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}service=${encodeURIComponent(service)}`
}

/** One service in the switcher — the body of `GET /__decoy__/services`. */
export interface ServiceInfo {
  name: string
}

/** Fetch the booted services (the switcher's list) from `GET /__decoy__/services`. */
export async function fetchServices(): Promise<ServiceInfo[]> {
  const response = await fetch('/__decoy__/services')
  if (!response.ok) {
    throw new Error(`GET /__decoy__/services failed: ${response.status}`)
  }
  return (await response.json()) as ServiceInfo[]
}

export interface RouteCatalogEntry {
  id: string
  method: string
  path: string
  presetCount: number
  variantCount: number
}

/** Fetch the routes catalog from `GET /__decoy__/routes`. Throws on a non-2xx response. */
export async function fetchRoutes(service: string | null): Promise<RouteCatalogEntry[]> {
  const response = await fetch(scoped('/__decoy__/routes', service))
  if (!response.ok) {
    throw new Error(`GET /__decoy__/routes failed: ${response.status}`)
  }
  return (await response.json()) as RouteCatalogEntry[]
}

/** A route's preset (request-match conditions) — mirrors the core `Preset`. */
export interface RoutePreset {
  query?: Record<string, string>
  headers?: Record<string, string>
  body?: unknown
  match?: string
}

/** One of a route's responses — mirrors the core `Variant`. */
export interface RouteVariant {
  status?: number
  headers?: Record<string, string>
  delay?: number
  body?: unknown
}

/** A route's full detail — the body of `GET /__decoy__/routes/{id}` (the server's `RouteDetail`). */
export interface RouteDetail {
  id: string
  method: string
  path: string
  presets: Record<string, RoutePreset>
  variants: Record<string, RouteVariant>
}

/** Fetch one route's presets and variants from `GET /__decoy__/routes/{id}`. */
export async function fetchRouteDetail(id: string, service: string | null): Promise<RouteDetail> {
  const response = await fetch(scoped(`/__decoy__/routes/${encodeURIComponent(id)}`, service))
  if (!response.ok) {
    throw new Error(`GET /__decoy__/routes/${id} failed: ${response.status}`)
  }
  return (await response.json()) as RouteDetail
}

/** A playground dry-run request posted to `POST /__decoy__/try`. */
export interface TryRequest {
  method: string
  path: string
  query?: Record<string, string>
  headers?: Record<string, string>
  body?: unknown
}

/** The dry-run outcome from `POST /__decoy__/try` (the server's `TryOutcome`). */
export interface TryResult {
  /** `route:preset:variant` · `MISS(reason)` · `PASSTHROUGH(target)`. */
  resolution: string
  /** The response the live server would serve, or `null` for a (not-forwarded) passthrough. */
  response: { status: number; headers: Record<string, string>; body: unknown } | null
}

/** Run a dry-run match against the current selection via `POST /__decoy__/try` (zero side effects). */
export async function tryRequest(input: TryRequest, service: string | null): Promise<TryResult> {
  const response = await fetch(scoped('/__decoy__/try', service), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!response.ok) {
    throw new Error(`POST /__decoy__/try failed: ${response.status}`)
  }
  return (await response.json()) as TryResult
}

/** A resolved `route:preset:variant` triple — mirrors the core `VariantAddress`. */
export interface VariantAddress {
  route: string
  preset: string
  variant: string
}

/** The only mutable state — mirrors the core `Selection`. */
export interface Selection {
  collection: string
  overrides?: VariantAddress[]
}

/** One collections-catalog entry — mirrors the server's `CollectionCatalogEntry`. */
export interface CollectionCatalogEntry {
  name: string
  extends?: string
  active: boolean
  entryCount: number
}

/** A collection's resolved detail — the body of `GET /__decoy__/collections/{name}`. */
export interface CollectionDetail {
  name: string
  extends?: string
  active: boolean
  entries: VariantAddress[]
}

/** Fetch the collections catalog from `GET /__decoy__/collections`. Throws on a non-2xx response. */
export async function fetchCollections(service: string | null): Promise<CollectionCatalogEntry[]> {
  const response = await fetch(scoped('/__decoy__/collections', service))
  if (!response.ok) {
    throw new Error(`GET /__decoy__/collections failed: ${response.status}`)
  }
  return (await response.json()) as CollectionCatalogEntry[]
}

/** Fetch one collection's resolved entries from `GET /__decoy__/collections/{name}`. */
export async function fetchCollectionDetail(
  name: string,
  service: string | null,
): Promise<CollectionDetail> {
  const response = await fetch(
    scoped(`/__decoy__/collections/${encodeURIComponent(name)}`, service),
  )
  if (!response.ok) {
    throw new Error(`GET /__decoy__/collections/${name} failed: ${response.status}`)
  }
  return (await response.json()) as CollectionDetail
}

/** Fetch the current selection from `GET /__decoy__/selection`. */
export async function fetchSelection(service: string | null): Promise<Selection> {
  const response = await fetch(scoped('/__decoy__/selection', service))
  if (!response.ok) {
    throw new Error(`GET /__decoy__/selection failed: ${response.status}`)
  }
  return (await response.json()) as Selection
}

/** POST a JSON control call to `/__decoy__/{path}`, returning the resulting selection. */
async function postControl(
  path: string,
  body: unknown,
  service: string | null,
): Promise<Selection> {
  const response = await fetch(scoped(`/__decoy__/${path}`, service), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!response.ok) {
    throw new Error(`POST /__decoy__/${path} failed: ${response.status}`)
  }
  return (await response.json()) as Selection
}

/** Switch the active collection via `POST /__decoy__/collection`. */
export function useCollection(name: string, service: string | null): Promise<Selection> {
  return postControl('collection', { name }, service)
}

/** Pin a route's `preset` slot to a variant via `POST /__decoy__/route`. */
export function pinRoute(
  route: string,
  preset: string,
  variant: string,
  service: string | null,
): Promise<Selection> {
  return postControl('route', { route, preset, variant }, service)
}

/** Drop all per-route overrides via `POST /__decoy__/reset`. */
export function resetOverrides(service: string | null): Promise<Selection> {
  return postControl('reset', undefined, service)
}

/** The outcome of matching one request — mirrors the server's `RequestOutcome`. */
export type RequestOutcome =
  | { type: 'matched'; address: { route: string; preset: string; variant: string } }
  | { type: 'miss'; reason: string }
  | { type: 'passthrough'; target: string }

/** One live request record streamed over `GET /__decoy__/logs` — the server's `StoredRequestLog`. */
export interface RequestLogRecord {
  /** Monotonic store-assigned id; used to dedupe replayed history on reconnect. */
  seq: number
  method: string
  path: string
  outcome: RequestOutcome
  status: number
  latencyMs: number
  session: string
  /** The instance (service) that served the request — present on stored records. */
  service: string | null
}

/** One live session — mirrors the server's `SessionInfo` (body of `GET /__decoy__/sessions`). */
export interface SessionInfo {
  /** `'global'` for the default (dev) session, otherwise the created session id. */
  id: string
  global: boolean
  collection: string
  overrideCount: number
}

/** Fetch the live sessions (global + created) from `GET /__decoy__/sessions`. */
export async function fetchSessions(service: string | null): Promise<SessionInfo[]> {
  const response = await fetch(scoped('/__decoy__/sessions', service))
  if (!response.ok) {
    throw new Error(`GET /__decoy__/sessions failed: ${response.status}`)
  }
  return (await response.json()) as SessionInfo[]
}

/**
 * Fetch a session's request timeline from `GET /__decoy__/sessions/{id}/logs` — ordered
 * across all services (one timeline) and readable after the session is destroyed.
 */
export async function fetchSessionLogs(id: string): Promise<RequestLogRecord[]> {
  const response = await fetch(`/__decoy__/sessions/${encodeURIComponent(id)}/logs`)
  if (!response.ok) {
    throw new Error(`GET /__decoy__/sessions/${id}/logs failed: ${response.status}`)
  }
  return (await response.json()) as RequestLogRecord[]
}

/** The resolution label for a record, mirroring the server logger's `describeOutcome`. */
export function resolutionOf(outcome: RequestOutcome): string {
  switch (outcome.type) {
    case 'matched': {
      const { route, preset, variant } = outcome.address
      return `${route}:${preset}:${variant}`
    }
    case 'miss':
      return `MISS(${outcome.reason})`
    case 'passthrough':
      return `PASSTHROUGH(${outcome.target})`
  }
}

/** A handle to the open live-request stream. */
export interface LogStream {
  close(): void
}

/**
 * Open the `GET /__decoy__/logs` SSE stream, invoking `onRecord` for every record
 * (replayed history first, then live tail). The browser `EventSource` reconnects
 * on drop and the server replays history, so callers must dedupe on `seq`.
 */
export function connectLogs(onRecord: (record: RequestLogRecord) => void): LogStream {
  const source = new EventSource('/__decoy__/logs')
  source.onmessage = (event) => {
    onRecord(JSON.parse(event.data) as RequestLogRecord)
  }
  return { close: () => source.close() }
}
