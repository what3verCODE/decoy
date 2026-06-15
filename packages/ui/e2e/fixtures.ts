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

export { expect, test } from '@playwright/test'
