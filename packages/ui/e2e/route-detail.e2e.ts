import { expect, test } from './fixtures'

// Dogfood: drilling into a route shows its presets/variants (GET
// /__decoy__/routes/{id}) and the playground fires POST /__decoy__/try, rendering the
// resolution + response. The control API is faked by the auto router fixture
// (decoy.config.ts + mocks/) — @decoy/ui ships static assets only, so the e2e never
// boots a server; the real engine match is covered by the server HTTP-seam tests.
test('opening a route shows its presets and variants', async ({ page }) => {
  await page.goto('/')

  // Route detail is an always-mounted tile; with nothing selected it shows a placeholder.
  await expect(page.getByTestId('route-detail-empty')).toBeVisible()

  await page
    .getByTestId('route-row')
    .filter({ hasText: 'users-by-id' })
    .getByTestId('route-open')
    .click()

  const detail = page.getByTestId('route-detail')
  await expect(detail).toBeVisible()
  await expect(detail).toContainText('/users/{id}')
  await expect(page.getByTestId('preset-row')).toHaveCount(2)
  await expect(detail).toContainText('with-query')
  await expect(page.getByTestId('variant-row')).toHaveCount(2)
  await expect(detail).toContainText('success')
  await expect(detail).toContainText('error')
})

test('the playground is pre-filled from the route and renders the dry-run result', async ({
  page,
}) => {
  await page.goto('/')
  await page
    .getByTestId('route-row')
    .filter({ hasText: 'users-by-id' })
    .getByTestId('route-open')
    .click()

  // Pre-filled from the route's method + path.
  await expect(page.getByTestId('playground-method')).toHaveValue('GET')
  await expect(page.getByTestId('playground-path')).toHaveValue('/users/{id}')

  await page.getByTestId('playground-send').click()

  await expect(page.getByTestId('playground-resolution')).toHaveText('users-by-id:default:success')
  await expect(page.getByTestId('playground-response')).toContainText('Ada')
})

test('the clear control deselects the route while both tiles stay mounted', async ({ page }) => {
  await page.goto('/')
  await page
    .getByTestId('route-row')
    .filter({ hasText: 'users-by-id' })
    .getByTestId('route-open')
    .click()
  await expect(page.getByTestId('route-detail')).toContainText('/users/{id}')

  // Clearing deselects the route — Route detail falls back to its placeholder, and the
  // Routes tile is unaffected (both are persistent tiles, not a switched view).
  await page.getByTestId('route-detail-back').click()

  await expect(page.getByTestId('route-detail-empty')).toBeVisible()
  await expect(page.getByTestId('routes-catalog')).toBeVisible()
})
