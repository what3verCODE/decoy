import { expect, sampleCatalog, stubRoutes, test } from './fixtures'

// Dogfood smoke (ADR-0017): the prebuilt SPA loads in a real browser and renders
// the routes catalog it fetched from GET /admin/routes. The API is stubbed in the
// browser (stubRoutes) — @decoy/ui is static assets only, so the e2e never boots a
// server; it proves the panel renders whatever the data API returns.
test('panel renders the routes catalog from GET /admin/routes', async ({ page }) => {
  await stubRoutes(page)
  await page.goto('/')

  await expect(page.getByTestId('route-row')).toHaveCount(sampleCatalog.length)
  await expect(page.getByTestId('routes-catalog')).toContainText('users-by-id')
  await expect(page.getByTestId('routes-catalog')).toContainText('create-order')
})

test('panel shows an empty state when the catalog is empty', async ({ page }) => {
  await stubRoutes(page, [])
  await page.goto('/')

  await expect(page.getByTestId('route-row')).toHaveCount(0)
  await expect(page.getByTestId('routes-catalog')).toContainText('no routes defined')
})
