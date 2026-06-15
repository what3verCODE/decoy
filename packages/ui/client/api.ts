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
