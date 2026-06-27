import { expect, test } from './fixtures'

// Dogfood: the collections panel drives the same-origin /__decoy__ control
// API, faked by the auto router fixture (decoy.config.ts + mocks/). @decoy/ui ships
// static assets only, so the e2e never boots a server — it proves the panel lists
// scenarios, marks the active one, and that switching / pinning / resetting send the
// control calls and reflect their results. The engine semantics (which variant the
// next request resolves to) are covered by the server's HTTP-seam control tests.
test('panel lists collections from GET /__decoy__/collections and marks the active one', async ({
  page,
}) => {
  await page.goto('/')

  await expect(page.getByTestId('collection-row')).toHaveCount(2)
  const panel = page.getByTestId('collections-panel')
  await expect(panel).toContainText('happy-path')
  await expect(panel).toContainText('error-state')
  await expect(
    page.getByTestId('collection-row').filter({ hasText: 'happy-path' }),
  ).toHaveAttribute('data-active', 'true')
  await expect(
    page.getByTestId('collection-row').filter({ hasText: 'error-state' }),
  ).toHaveAttribute('data-active', 'false')
})

test('shows an empty state when no collections are defined', async ({ page, router }) => {
  await router.useRoute('admin-collections', 'default', 'empty')
  await page.goto('/')

  await expect(page.getByTestId('collection-row')).toHaveCount(0)
  await expect(page.getByTestId('collections-panel')).toContainText('no collections defined')
})

test('switching a collection moves the active marker (POST /__decoy__/collection)', async ({
  page,
}) => {
  await page.goto('/')

  await page.getByTestId('collection-row').filter({ hasText: 'error-state' }).click()

  await expect(
    page.getByTestId('collection-row').filter({ hasText: 'error-state' }),
  ).toHaveAttribute('data-active', 'true')
  await expect(
    page.getByTestId('collection-row').filter({ hasText: 'happy-path' }),
  ).toHaveAttribute('data-active', 'false')
})

test('pinning a route override raises the override count (POST /__decoy__/route)', async ({
  page,
}) => {
  await page.goto('/')

  // No overrides yet → no count badge, no reset control.
  await expect(page.getByTestId('override-count')).toHaveCount(0)

  await page
    .getByTestId('entry-row')
    .filter({ hasText: 'users-by-id:default:success' })
    .getByTestId('entry-pin')
    .click()

  await expect(page.getByTestId('override-count')).toContainText('1 pinned')
  await expect(
    page
      .getByTestId('entry-row')
      .filter({ hasText: 'users-by-id:default:success' })
      .getByTestId('entry-pin'),
  ).toHaveAttribute('data-pinned', 'true')
})

test('reset clears all overrides (POST /__decoy__/reset)', async ({ page }) => {
  await page.goto('/')

  await page
    .getByTestId('entry-row')
    .filter({ hasText: 'users-by-id:default:success' })
    .getByTestId('entry-pin')
    .click()
  await expect(page.getByTestId('override-count')).toContainText('1 pinned')

  await page.getByTestId('overrides-reset').click()

  await expect(page.getByTestId('override-count')).toHaveCount(0)
  await expect(page.getByTestId('overrides-reset')).toHaveCount(0)
})
