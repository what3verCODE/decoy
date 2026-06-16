import { expect, test } from './fixtures'

// Dogfood smoke (ADR-0017): the prebuilt SPA loads in a real browser and renders the
// routes catalog it fetched from GET /__decoy__/routes. The control API is faked by the
// auto router fixture (decoy.config.ts + mocks/) — @decoy/ui is static assets only,
// so the e2e never boots a server; it proves the panel renders whatever the API
// returns. The empty state pins the route's `empty` variant via the control handle.
test('panel renders the routes catalog from GET /__decoy__/routes', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByTestId('route-row')).toHaveCount(2)
  await expect(page.getByTestId('routes-catalog')).toContainText('users-by-id')
  await expect(page.getByTestId('routes-catalog')).toContainText('create-order')
})

test('panel shows an empty state when the catalog is empty', async ({ page, router }) => {
  await router.useRoute('admin-routes', 'default', 'empty')
  await page.goto('/')

  await expect(page.getByTestId('route-row')).toHaveCount(0)
  await expect(page.getByTestId('routes-catalog')).toContainText('no routes defined')
})
