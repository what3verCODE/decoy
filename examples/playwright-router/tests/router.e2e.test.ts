import { createPlaywrightRouter } from '@decoy/playwright'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'

// Helpers driving the SPA from the user's side: click a button to fire the fetch.
async function loadUser(page: Page) {
  await page.getByTestId('load-user').click()
}
async function loadMissing(page: Page) {
  await page.getByTestId('load-missing').click()
}

test('serves the mocked variant and renders it in the DOM', async ({ page }) => {
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

test('parallel browser contexts stay isolated', async ({ browser, baseURL }) => {
  const open = async () => {
    const context = await browser.newContext({ baseURL })
    const router = await createPlaywrightRouter(context, { url: /\/api\// })
    const page = await context.newPage()
    await page.goto('/')
    return { context, router, page }
  }

  const a = await open()
  const b = await open()
  try {
    // Flip only context A into the error scenario.
    await a.router.useCollection('error-state')

    await a.page.getByTestId('load-user').click()
    await expect(a.page.getByTestId('status')).toHaveText('500')

    // Context B never moved — it still serves the happy path.
    await b.page.getByTestId('load-user').click()
    await expect(b.page.getByTestId('status')).toHaveText('200')
    await expect(b.page.getByTestId('body')).toContainText('Ada')
  } finally {
    await a.context.close()
    await b.context.close()
  }
})
