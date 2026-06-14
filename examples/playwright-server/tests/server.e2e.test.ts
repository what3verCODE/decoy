import { createSessionRouter } from '@decoy/control'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'

// Helpers driving the SPA from the user's side: click a button to fire the fetch.
async function loadUser(page: Page) {
  await page.getByTestId('load-user').click()
}
async function loadMissing(page: Page) {
  await page.getByTestId('load-missing').click()
}

test('serves the mocked variant from the live server and renders it', async ({ page }) => {
  await page.goto('/')
  await loadUser(page)

  await expect(page.getByTestId('status')).toHaveText('200')
  await expect(page.getByTestId('body')).toContainText('Ada')
})

test('useCollection switches the scenario the next request sees', async ({ page, router }) => {
  await page.goto('/')
  await loadUser(page)
  await expect(page.getByTestId('status')).toHaveText('200')

  await router.useCollection('error-state')
  await loadUser(page)

  await expect(page.getByTestId('status')).toHaveText('500')
  await expect(page.getByTestId('body')).toContainText('upstream exploded')
})

test('useRoute overrides a single route; reset restores the baseline', async ({ page, router }) => {
  await page.goto('/')

  await router.useRoute('users-by-id', 'default', 'boom')
  await loadUser(page)
  await expect(page.getByTestId('status')).toHaveText('500')

  await router.reset()
  await loadUser(page)
  await expect(page.getByTestId('status')).toHaveText('200')
  await expect(page.getByTestId('body')).toContainText('Ada')
})

test('a miss fails closed (501 + x-mock-miss) and the UI surfaces it', async ({ page }) => {
  await page.goto('/')
  await loadMissing(page)

  await expect(page.getByTestId('status')).toHaveText('501')
  await expect(page.getByTestId('miss')).toHaveText('true')
})

test('parallel sessions stay isolated on the shared server', async ({
  browser,
  stack,
  baseURL,
}) => {
  // Two browser contexts, each owning its own server session (x-mock-session). The
  // headline demo: flipping one session's scenario does not leak into the other,
  // even though both hit the same live Decoy server.
  const open = async () => {
    const context = await browser.newContext({ baseURL })
    const router = await createSessionRouter({ baseUrl: stack.decoyBaseUrl })
    await router.stampOn(context)
    const page = await context.newPage()
    await page.goto('/')
    return { context, router, page }
  }

  const a = await open()
  const b = await open()
  try {
    // Flip only session A into the error scenario.
    await a.router.useCollection('error-state')

    await a.page.getByTestId('load-user').click()
    await expect(a.page.getByTestId('status')).toHaveText('500')

    // Session B never moved — it still serves the happy path.
    await b.page.getByTestId('load-user').click()
    await expect(b.page.getByTestId('status')).toHaveText('200')
    await expect(b.page.getByTestId('body')).toContainText('Ada')
  } finally {
    await a.router.destroy()
    await b.router.destroy()
    await a.context.close()
    await b.context.close()
  }
})
