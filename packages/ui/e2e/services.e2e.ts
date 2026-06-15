import { expect, test } from './fixtures'

// Dogfood (ADR-0017, #72): with an array config one `--ui` server aggregates every
// instance behind a service switcher. The control API is faked by the auto router
// fixture (decoy.config.ts + mocks/) — @decoy/ui ships static assets only, so the
// e2e never boots a server. The catalog mock is per-instance (a `?service=orders`
// preset), so switching the service in the UI re-targets the control calls and the
// catalog changes — proving each instance is controlled independently. The aggregated
// logs view is covered by the live-stream e2e.
test('the switcher lists every service and defaults to the first', async ({ page }) => {
  await page.goto('/')

  const switcher = page.getByTestId('service-switcher')
  await expect(switcher).toBeVisible()
  await expect(switcher.locator('option')).toHaveText(['users', 'orders'])
  await expect(switcher).toHaveValue('users')
  // The default (users) instance's catalog renders.
  await expect(page.getByTestId('routes-catalog')).toContainText('users-by-id')
})

test('switching the service re-targets control and loads that instance’s catalog', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.getByTestId('routes-catalog')).toContainText('users-by-id')

  // Switch to orders: the catalog request now carries ?service=orders and resolves
  // to the orders instance's routes (per-instance control).
  await page.getByTestId('service-switcher').selectOption('orders')
  await expect(page.getByTestId('routes-catalog')).toContainText('orders-by-id')
  await expect(page.getByTestId('routes-catalog')).not.toContainText('users-by-id')

  // Switching back restores the users instance — selection is independent per service.
  await page.getByTestId('service-switcher').selectOption('users')
  await expect(page.getByTestId('routes-catalog')).toContainText('users-by-id')
  await expect(page.getByTestId('routes-catalog')).not.toContainText('orders-by-id')
})

test('a single-instance config still shows one entry in the switcher', async ({ page, router }) => {
  await router.useRoute('admin-services', 'default', 'solo')
  await page.goto('/')

  const switcher = page.getByTestId('service-switcher')
  await expect(switcher.locator('option')).toHaveText(['users'])
  await expect(switcher).toHaveValue('users')
  await expect(page.getByTestId('routes-catalog')).toContainText('users-by-id')
})
