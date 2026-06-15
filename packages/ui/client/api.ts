// The data API the SPA fetches from its own (loopback) origin — same origin as the
// served assets, so no CORS (ADR-0017). Mirrors the server's RouteCatalogEntry.

export interface RouteCatalogEntry {
  id: string
  method: string
  path: string
  presetCount: number
  variantCount: number
}

/** Fetch the routes catalog from `GET /admin/routes`. Throws on a non-2xx response. */
export async function fetchRoutes(): Promise<RouteCatalogEntry[]> {
  const response = await fetch('/admin/routes')
  if (!response.ok) {
    throw new Error(`GET /admin/routes failed: ${response.status}`)
  }
  return (await response.json()) as RouteCatalogEntry[]
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

/** A collection's resolved detail — the body of `GET /admin/collections/{name}`. */
export interface CollectionDetail {
  name: string
  extends?: string
  active: boolean
  entries: VariantAddress[]
}

/** Fetch the collections catalog from `GET /admin/collections`. Throws on a non-2xx response. */
export async function fetchCollections(): Promise<CollectionCatalogEntry[]> {
  const response = await fetch('/admin/collections')
  if (!response.ok) {
    throw new Error(`GET /admin/collections failed: ${response.status}`)
  }
  return (await response.json()) as CollectionCatalogEntry[]
}

/** Fetch one collection's resolved entries from `GET /admin/collections/{name}`. */
export async function fetchCollectionDetail(name: string): Promise<CollectionDetail> {
  const response = await fetch(`/admin/collections/${encodeURIComponent(name)}`)
  if (!response.ok) {
    throw new Error(`GET /admin/collections/${name} failed: ${response.status}`)
  }
  return (await response.json()) as CollectionDetail
}

/** Fetch the current selection from `GET /admin/selection`. */
export async function fetchSelection(): Promise<Selection> {
  const response = await fetch('/admin/selection')
  if (!response.ok) {
    throw new Error(`GET /admin/selection failed: ${response.status}`)
  }
  return (await response.json()) as Selection
}

/** POST a JSON control call to `/admin/{path}`, returning the resulting selection. */
async function postControl(path: string, body?: unknown): Promise<Selection> {
  const response = await fetch(`/admin/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!response.ok) {
    throw new Error(`POST /admin/${path} failed: ${response.status}`)
  }
  return (await response.json()) as Selection
}

/** Switch the active collection via `POST /admin/collection`. */
export function setCollection(name: string): Promise<Selection> {
  return postControl('collection', { name })
}

/** Pin a route's `preset` slot to a variant via `POST /admin/route`. */
export function pinRoute(route: string, preset: string, variant: string): Promise<Selection> {
  return postControl('route', { route, preset, variant })
}

/** Drop all per-route overrides via `POST /admin/reset`. */
export function resetOverrides(): Promise<Selection> {
  return postControl('reset')
}

/** The outcome of matching one request — mirrors the server's `RequestOutcome`. */
export type RequestOutcome =
  | { type: 'matched'; address: { route: string; preset: string; variant: string } }
  | { type: 'miss'; reason: string }
  | { type: 'passthrough'; target: string }

/** One live request record streamed over `GET /admin/logs` — the server's `StoredRequestLog`. */
export interface RequestLogRecord {
  /** Monotonic store-assigned id; used to dedupe replayed history on reconnect. */
  seq: number
  method: string
  path: string
  outcome: RequestOutcome
  status: number
  latencyMs: number
  session: string
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
 * Open the `GET /admin/logs` SSE stream, invoking `onRecord` for every record
 * (replayed history first, then live tail). The browser `EventSource` reconnects
 * on drop and the server replays history, so callers must dedupe on `seq`.
 */
export function connectLogs(onRecord: (record: RequestLogRecord) => void): LogStream {
  const source = new EventSource('/admin/logs')
  source.onmessage = (event) => {
    onRecord(JSON.parse(event.data) as RequestLogRecord)
  }
  return { close: () => source.close() }
}
