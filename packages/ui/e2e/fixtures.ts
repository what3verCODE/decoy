import type { Collection, Definitions, Route, Variant } from '@decoy/core'
import { createPlaywrightRouter } from '@decoy/playwright'
import type { Page } from '@playwright/test'

// Dogfood seam (#76): the panel's same-origin data API is mocked with @decoy/playwright
// — the in-browser PlaywrightRouter over `page.route` — exactly the way an external
// adopter tests their own app, rather than hand-rolled `route.fulfill`. Both endpoints
// are expressed as decoy variants: GET /admin/routes serves the catalog as a JSON
// variant, GET /admin/logs serves a `text/event-stream` variant whose body is the
// pre-built SSE frames (decoy passes a string body + explicit content-type through
// verbatim). @decoy/ui ships static assets only, so the e2e never boots a server; the
// live-server integration stays covered by the HTTP-seam tests in server/cli.

/** A routes-catalog payload shaped exactly like the server's `GET /admin/routes`. */
export const sampleCatalog = [
  { id: 'users-by-id', method: 'GET', path: '/users/{id}', presetCount: 1, variantCount: 2 },
  { id: 'create-order', method: 'POST', path: '/orders', presetCount: 2, variantCount: 2 },
]

/** A live-request stream payload shaped like the server's `GET /admin/logs` SSE records. */
export const sampleLogs = [
  {
    seq: 1,
    method: 'GET',
    path: '/users/42',
    outcome: {
      type: 'matched',
      address: { route: 'users-by-id', preset: 'default', variant: 'success' },
    },
    status: 200,
    latencyMs: 1.2,
    session: 'global',
  },
  {
    seq: 2,
    method: 'GET',
    path: '/missing',
    outcome: { type: 'miss', reason: 'no-route' },
    status: 501,
    latencyMs: 0.4,
    session: 'global',
  },
]

/** Build the `id:/data:` SSE frame body the server's `GET /admin/logs` streams. */
function sseBody(records: readonly unknown[]): string {
  return records
    .map((r) => `id: ${(r as { seq: number }).seq}\ndata: ${JSON.stringify(r)}\n\n`)
    .join('')
}

/** Single-route definitions activating `route`'s one `default:<variant>` entry. */
function definitions(route: Route, variant: string): Definitions {
  const collection: Collection = { id: 'default', routes: [`${route.id}:default:${variant}`] }
  return {
    routes: new Map([[route.id, route]]),
    collections: new Map([[collection.id, collection]]),
  }
}

/** Install a PlaywrightRouter on `page` scoped to a single admin endpoint. */
async function mountAdmin(page: Page, url: string, route: Route, variant: string): Promise<void> {
  await createPlaywrightRouter(page, {
    definitions: definitions(route, variant),
    defaultCollection: 'default',
    url,
  })
}

/**
 * Mock the panel's `GET /admin/routes` with @decoy/playwright, serving `catalog` as a
 * JSON variant. The router is scoped to the admin path, so the SPA's own assets load
 * untouched; @decoy/ui ships static assets only, so the e2e never boots a server.
 */
export async function stubRoutes(page: Page, catalog: unknown = sampleCatalog): Promise<void> {
  const route: Route = {
    id: 'admin-routes',
    method: 'GET',
    path: '/admin/routes',
    presets: { default: {} },
    variants: { catalog: { status: 200, body: catalog } },
  }
  await mountAdmin(page, '**/admin/routes', route, 'catalog')
}

/**
 * Mock the panel's `GET /admin/logs` SSE stream with @decoy/playwright, serving
 * `records` as a `text/event-stream` variant whose body is the SSE frames. EventSource
 * reconnects and re-reads the same one-shot body; the client dedupes on `seq`, so
 * reconnect-and-replay does not duplicate rows.
 */
export async function stubLogs(page: Page, records: unknown[] = sampleLogs): Promise<void> {
  const variant: Variant = {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
    body: sseBody(records),
  }
  const route: Route = {
    id: 'admin-logs',
    method: 'GET',
    path: '/admin/logs',
    presets: { default: {} },
    variants: { stream: variant },
  }
  await mountAdmin(page, '**/admin/logs', route, 'stream')
}

export { expect, test } from '@playwright/test'
