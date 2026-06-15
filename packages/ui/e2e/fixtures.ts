import type { Page } from '@playwright/test'

/** A routes-catalog payload shaped exactly like the server's `GET /admin/routes`. */
export const sampleCatalog = [
  { id: 'users-by-id', method: 'GET', path: '/users/{id}', presetCount: 1, variantCount: 2 },
  { id: 'create-order', method: 'POST', path: '/orders', presetCount: 2, variantCount: 2 },
]

/**
 * Stub the panel's same-origin data API in the browser, so the e2e renders the SPA
 * against fixture data with **no server** (`@decoy/ui` ships static assets only).
 * The integration against a live `@decoy/server` is covered by the HTTP-seam tests
 * over there; here we prove the panel renders what the API returns.
 */
export async function stubRoutes(page: Page, catalog: unknown = sampleCatalog): Promise<void> {
  await page.route('**/admin/routes', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(catalog) }),
  )
}

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

/**
 * Stub the panel's `GET /admin/logs` SSE stream in the browser, serving `records`
 * as a one-shot event-stream body (`@decoy/ui` ships static assets only, so the
 * e2e never boots a server). The client dedupes on `seq`, so `EventSource`'s
 * reconnect-and-replay does not duplicate rows.
 */
export async function stubLogs(page: Page, records: unknown[] = sampleLogs): Promise<void> {
  const body = records
    .map((r) => `id: ${(r as { seq: number }).seq}\ndata: ${JSON.stringify(r)}\n\n`)
    .join('')
  await page.route('**/admin/logs', (route) =>
    route.fulfill({ contentType: 'text/event-stream', body }),
  )
}

export { expect, test } from '@playwright/test'
