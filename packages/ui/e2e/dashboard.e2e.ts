import type { Locator } from '@playwright/test'
import { expect, test } from './fixtures'

/** A laid-out element's box; asserts it is rendered (boundingBox is null when detached). */
async function boxOf(
  locator: Locator,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await locator.boundingBox()
  expect(box, 'expected the element to be laid out').not.toBeNull()
  return box as { x: number; y: number; width: number; height: number }
}

// Dogfood smoke (ADR-0017): the prebuilt SPA renders the control panel as a
// react-grid-layout tile dashboard (#89) instead of the old fixed flex columns. The
// control API is faked by the auto router fixture (decoy.config.ts + mocks/) — @decoy/ui
// is static assets only, so the e2e never boots a server. This slice keeps today's
// three regions — Collections, the catalog/detail/sessions Center, and Logs — each
// wrapped in a draggable/resizable tile; it doubles as the preact/compat viability
// spike, so the drag smoke below asserts react-grid-layout's physics work under Preact.

test('the dashboard renders Collections, Center, and Logs as grid tiles', async ({ page }) => {
  await page.goto('/')

  // The grid container and all three tiles mount.
  await expect(page.getByTestId('dashboard')).toBeVisible()
  await expect(page.getByTestId('tile-collections')).toBeVisible()
  await expect(page.getByTestId('tile-center')).toBeVisible()
  await expect(page.getByTestId('tile-logs')).toBeVisible()

  // Each tile still renders its panel content, driven by the unchanged effector models.
  await expect(page.getByTestId('collections-panel')).toContainText('happy-path')
  await expect(page.getByTestId('routes-catalog')).toContainText('users-by-id')
  await expect(page.getByTestId('live-stream')).toContainText('/users/42')
})

test('the default arrangement mirrors the old layout: Collections left, Center, Logs right', async ({
  page,
}) => {
  await page.goto('/')

  const left = await boxOf(page.getByTestId('tile-collections'))
  const center = await boxOf(page.getByTestId('tile-center'))
  const right = await boxOf(page.getByTestId('tile-logs'))
  // Collections sits left of Center, which sits left of Logs — today's spatial order.
  expect(left.x).toBeLessThan(center.x)
  expect(center.x).toBeLessThan(right.x)
})

test('tile headers act as drag handles, and inner controls stay clickable', async ({ page }) => {
  await page.goto('/')

  // The header doubles as react-grid-layout's draggableHandle.
  await expect(page.getByTestId('tile-logs').locator('.tile-drag-handle')).toBeVisible()

  // A control inside a tile still works (not swallowed by the drag handle): pausing
  // the live stream flips the button label.
  const pause = page.getByTestId('logs-pause')
  await expect(pause).toHaveText('pause')
  await pause.click()
  await expect(pause).toHaveText('resume')
})

// The preact/compat spike: prove react-grid-layout's drag physics run under Preact by
// dragging a tile by its header and asserting the grid item's transform actually moved.
// We assert our wiring works (a drag produces a changed position), not RGL's pixel math.
test('dragging a tile header moves it (react-grid-layout works under preact/compat)', async ({
  page,
}) => {
  await page.goto('/')

  const collections = page.getByTestId('tile-collections')
  const center = page.getByTestId('tile-center')

  // Collections starts as the leftmost tile (left of Center).
  const collectionsStart = await boxOf(collections)
  const centerStart = await boxOf(center)
  expect(collectionsStart.x).toBeLessThan(centerStart.x)

  // Drag the Collections header across the whole grid to the far right, so it lands in a
  // right-hand column past Center — a real, persisted layout change that only happens if
  // react-grid-layout's drag actually fires under preact/compat.
  const box = await boxOf(collections.locator('.tile-drag-handle'))
  const viewport = page.viewportSize() ?? { width: 1280, height: 720 }
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(viewport.width - 40, box.y + box.height / 2, { steps: 20 })
  await page.mouse.up()

  // Order flipped: Collections is now to the right of Center.
  await expect(async () => {
    const collectionsEnd = await boxOf(collections)
    const centerEnd = await boxOf(center)
    expect(collectionsEnd.x).toBeGreaterThan(centerEnd.x)
  }).toPass()
})
