import { expect, test } from './fixtures'

// Dogfood (ADR-0017): the sessions inspector drives the same-origin /admin sessions
// API, faked by the auto router fixture (decoy.config.ts + mocks/). @decoy/ui ships
// static assets only, so the e2e never boots a server — it proves the panel lists
// sessions (global + created) and that drilling into one shows its (cross-service)
// request timeline. The store/lifecycle semantics (survives destroy, one ordered
// cross-service timeline) are covered by the server's HTTP-seam admin tests.
test('the sessions view lists the global session plus created sessions', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('nav-sessions').click()

  await expect(page.getByTestId('session-row')).toHaveCount(2)
  const panel = page.getByTestId('sessions-panel')
  await expect(panel).toContainText('global')
  await expect(panel).toContainText('sess-1')
  await expect(page.getByTestId('session-row').filter({ hasText: 'global' })).toContainText(
    'happy-path',
  )
})

test('a created session appears and its request timeline is viewable', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('nav-sessions').click()

  // No timeline until a session is selected.
  await expect(page.getByTestId('session-timeline')).toHaveCount(0)

  await page.getByTestId('session-row').filter({ hasText: 'sess-1' }).click()

  const timeline = page.getByTestId('session-timeline')
  await expect(timeline).toBeVisible()
  await expect(page.getByTestId('timeline-row')).toHaveCount(2)
  // One ordered cross-service timeline: the users request, then the orders request.
  await expect(page.getByTestId('timeline-row').first()).toContainText('/users/7')
  await expect(page.getByTestId('timeline-row').first()).toContainText('users')
  await expect(page.getByTestId('timeline-row').nth(1)).toContainText('/orders')
  await expect(page.getByTestId('timeline-row').nth(1)).toContainText('orders')
})

test('shows a global-only list when no sessions have been created', async ({ page, router }) => {
  await router.useRoute('admin-sessions', 'default', 'solo')
  await page.goto('/')
  await page.getByTestId('nav-sessions').click()

  await expect(page.getByTestId('session-row')).toHaveCount(1)
  await expect(page.getByTestId('sessions-panel')).toContainText('global')
})
