import { expect, sampleLogs, stubLogs, stubRoutes, test } from './fixtures'

// Dogfood smoke (ADR-0017): the prebuilt SPA renders the live request stream it
// reads from the GET /admin/logs SSE endpoint. The stream is stubbed in the
// browser (stubLogs) — @decoy/ui is static assets only, so the e2e never boots a
// server; it proves the panel renders whatever the stream emits.
test('live-stream panel renders request records from the SSE stream', async ({ page }) => {
  await stubRoutes(page)
  await stubLogs(page)
  await page.goto('/')

  await expect(page.getByTestId('log-row')).toHaveCount(sampleLogs.length)
  const panel = page.getByTestId('live-stream')
  await expect(panel).toContainText('/users/42')
  await expect(panel).toContainText('users-by-id:default:success')
  // Newest-on-top: the miss (seq 2) renders above the matched record (seq 1).
  await expect(page.getByTestId('log-row').first()).toContainText('/missing')
})

test('fail-closed misses are highlighted distinctly', async ({ page }) => {
  await stubRoutes(page)
  await stubLogs(page)
  await page.goto('/')

  const panel = page.getByTestId('live-stream')
  await expect(panel).toContainText('MISS(no-route)')
  // The miss row carries the rose miss highlight; the matched row does not.
  await expect(page.getByTestId('log-row').first()).toHaveClass(/rose/)
  await expect(page.getByTestId('log-row').nth(1)).not.toHaveClass(/rose/)
})

test('clear empties the live stream', async ({ page }) => {
  await stubRoutes(page)
  await stubLogs(page)
  await page.goto('/')

  await expect(page.getByTestId('log-row')).toHaveCount(sampleLogs.length)
  await page.getByTestId('logs-clear').click()
  await expect(page.getByTestId('log-row')).toHaveCount(0)
  await expect(page.getByTestId('live-stream')).toContainText('waiting for requests…')
})

test('shows a waiting state when the stream is empty', async ({ page }) => {
  await stubRoutes(page)
  await stubLogs(page, [])
  await page.goto('/')

  await expect(page.getByTestId('log-row')).toHaveCount(0)
  await expect(page.getByTestId('live-stream')).toContainText('waiting for requests…')
})
