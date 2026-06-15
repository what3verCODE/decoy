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
