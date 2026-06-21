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
// react-grid-layout tile dashboard (#89/#90) instead of the old fixed flex columns. The
// control API is faked by the auto router fixture (decoy.config.ts + mocks/) — @decoy/ui
// is static assets only, so the e2e never boots a server. Slice 2 (#90) decomposes the
// panel into six reactive tiles — Collections, Current routes, Routes, Route detail,
// Logs, Sessions — each a draggable/resizable tile driven by its effector model; the
// drag smoke below asserts react-grid-layout's physics work under preact/compat.

test('the dashboard renders all six reactive tiles', async ({ page }) => {
  await page.goto('/')

  // The grid container and all six tiles mount concurrently.
  await expect(page.getByTestId('dashboard')).toBeVisible()
  await expect(page.getByTestId('tile-collections')).toBeVisible()
  await expect(page.getByTestId('tile-current-routes')).toBeVisible()
  await expect(page.getByTestId('tile-routes')).toBeVisible()
  await expect(page.getByTestId('tile-route-detail')).toBeVisible()
  await expect(page.getByTestId('tile-logs')).toBeVisible()
  await expect(page.getByTestId('tile-sessions')).toBeVisible()

  // The catalog/sessions top-bar nav is gone — both are persistent tiles now.
  await expect(page.getByTestId('nav-catalog')).toHaveCount(0)
  await expect(page.getByTestId('nav-sessions')).toHaveCount(0)

  // Each tile renders its panel content, driven by the unchanged effector models.
  await expect(page.getByTestId('collections-panel')).toContainText('happy-path')
  await expect(page.getByTestId('routes-catalog')).toContainText('users-by-id')
  await expect(page.getByTestId('live-stream')).toContainText('/users/42')
  await expect(page.getByTestId('sessions-panel')).toContainText('global')
})

test('the default arrangement mirrors the old layout: collections left, routes center, logs right', async ({
  page,
}) => {
  await page.goto('/')

  const left = await boxOf(page.getByTestId('tile-collections'))
  const center = await boxOf(page.getByTestId('tile-routes'))
  const right = await boxOf(page.getByTestId('tile-logs'))
  // Collections sits left of Routes, which sits left of Logs — today's spatial order.
  expect(left.x).toBeLessThan(center.x)
  expect(center.x).toBeLessThan(right.x)

  // Current routes stacks under Collections; Route detail under Routes; Sessions under Logs.
  const collections = await boxOf(page.getByTestId('tile-collections'))
  const currentRoutes = await boxOf(page.getByTestId('tile-current-routes'))
  expect(currentRoutes.y).toBeGreaterThan(collections.y)
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
  const routes = page.getByTestId('tile-routes')

  // Collections starts as the leftmost column tile (left of the center Routes tile).
  const collectionsStart = await boxOf(collections)
  const routesStart = await boxOf(routes)
  expect(collectionsStart.x).toBeLessThan(routesStart.x)

  // Drag the Collections header across the whole grid to the far right, so it lands in a
  // right-hand column past Routes — a real, persisted layout change that only happens if
  // react-grid-layout's drag actually fires under preact/compat.
  const box = await boxOf(collections.locator('.tile-drag-handle'))
  const viewport = page.viewportSize() ?? { width: 1280, height: 720 }
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(viewport.width - 40, box.y + box.height / 2, { steps: 20 })
  await page.mouse.up()

  // Order flipped: Collections is now to the right of the Routes tile.
  await expect(async () => {
    const collectionsEnd = await boxOf(collections)
    const routesEnd = await boxOf(routes)
    expect(collectionsEnd.x).toBeGreaterThan(routesEnd.x)
  }).toPass()
})
