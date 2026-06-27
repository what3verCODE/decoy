import { expect, test } from './fixtures'

// Dogfood smoke: the prebuilt SPA renders the live request stream it reads
// from the GET /__decoy__/logs SSE endpoint. The control API is faked by the auto router
// fixture (decoy.config.ts + mocks/) — @decoy/ui is static assets only, so the e2e
// never boots a server; it proves the panel renders whatever the stream emits. The
// baseline `stream` variant replays two records; the empty state pins `empty`.
test('live-stream panel renders request records from the SSE stream', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByTestId('log-row')).toHaveCount(2)
  const panel = page.getByTestId('live-stream')
  await expect(panel).toContainText('/users/42')
  await expect(panel).toContainText('users-by-id:default:success')
  // Newest-on-top: the miss (seq 2) renders above the matched record (seq 1).
  await expect(page.getByTestId('log-row').first()).toContainText('/missing')
})

test('the live stream labels each record by service (aggregated across services)', async ({
  page,
}) => {
  await page.goto('/')

  // The aggregated stream carries records from every service, each labelled (#72):
  // the matched record is the users instance, the miss is the orders instance.
  await expect(page.getByTestId('log-service')).toHaveCount(2)
  const stream = page.getByTestId('live-stream')
  await expect(stream).toContainText('users')
  await expect(stream).toContainText('orders')
})

test('fail-closed misses are highlighted distinctly', async ({ page }) => {
  await page.goto('/')

  const panel = page.getByTestId('live-stream')
  await expect(panel).toContainText('MISS(no-route)')
  // The miss row carries the rose miss highlight; the matched row does not.
  await expect(page.getByTestId('log-row').first()).toHaveClass(/rose/)
  await expect(page.getByTestId('log-row').nth(1)).not.toHaveClass(/rose/)
})

test('clear empties the live stream', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByTestId('log-row')).toHaveCount(2)
  await page.getByTestId('logs-clear').click()
  await expect(page.getByTestId('log-row')).toHaveCount(0)
  await expect(page.getByTestId('live-stream')).toContainText('waiting for requests…')
})

test('shows a waiting state when the stream is empty', async ({ page, router }) => {
  await router.useRoute('admin-logs', 'default', 'empty')
  await page.goto('/')

  await expect(page.getByTestId('log-row')).toHaveCount(0)
  await expect(page.getByTestId('live-stream')).toContainText('waiting for requests…')
})
