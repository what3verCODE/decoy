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

/**
 * Unlock the grid (#92): the dashboard boots locked, so drag/resize and the mutational
 * layout controls (reset) are gated behind the top-bar Edit layout toggle. Tests that
 * exercise a move/resize or the reset control flip it on first.
 */
async function enableEditMode(page: import('@playwright/test').Page): Promise<void> {
  await page.getByTestId('edit-layout').click()
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
  await enableEditMode(page) // drag is gated behind edit mode (#92)

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

// Slice 3 (#91): the layout is local-first. A single `{ version, layouts, hidden }` object
// in localStorage is the source of truth — saved on every move/resize, reloaded with
// migration. These tests seed localStorage via `page.addInitScript` (runs before any app
// code), so we exercise the load path the way a returning user hits it. The key/shape
// mirror create-layout-model.ts (LAYOUT_STORAGE_KEY / LAYOUT_VERSION).
const LAYOUT_KEY = 'decoy.dashboard.layout'

/** Seed localStorage with a layout object before the SPA boots. */
async function seedLayout(page: import('@playwright/test').Page, raw: unknown): Promise<void> {
  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key, value as string)
    },
    [LAYOUT_KEY, typeof raw === 'string' ? raw : JSON.stringify(raw)] as const,
  )
}

// A layout that swaps the default left/right order: Collections parked far right, Routes
// pulled to the left edge — the inverse of the default arrangement, so a single x-compare
// proves it's the *saved* layout being honoured, not the default.
const SWAPPED_LG = [
  { i: 'collections', x: 8, y: 0, w: 4, h: 6 },
  { i: 'current-routes', x: 8, y: 6, w: 4, h: 6 },
  { i: 'routes', x: 0, y: 0, w: 3, h: 6 },
  { i: 'route-detail', x: 0, y: 6, w: 3, h: 6 },
  { i: 'logs', x: 3, y: 0, w: 5, h: 6 },
  { i: 'sessions', x: 3, y: 6, w: 5, h: 6 },
]

test('a saved layout is restored and survives a reload', async ({ page }) => {
  await seedLayout(page, { version: 1, layouts: { lg: SWAPPED_LG }, hidden: [] })
  await page.goto('/')

  // The seeded (swapped) order wins over the default: Collections now right of Routes.
  await expect(async () => {
    const collections = await boxOf(page.getByTestId('tile-collections'))
    const routes = await boxOf(page.getByTestId('tile-routes'))
    expect(collections.x).toBeGreaterThan(routes.x)
  }).toPass()

  // It persists across a fresh load (the model wrote nothing destructive; storage holds).
  await page.reload()
  await expect(async () => {
    const collections = await boxOf(page.getByTestId('tile-collections'))
    const routes = await boxOf(page.getByTestId('tile-routes'))
    expect(collections.x).toBeGreaterThan(routes.x)
  }).toPass()
})

test('a move persists across a reload', async ({ page }) => {
  await page.goto('/')
  await enableEditMode(page) // drag is gated behind edit mode (#92)

  const collections = page.getByTestId('tile-collections')
  const routes = page.getByTestId('tile-routes')
  expect((await boxOf(collections)).x).toBeLessThan((await boxOf(routes)).x)

  // Drag Collections to the far right so it lands past Routes — a real layout change.
  const handle = await boxOf(collections.locator('.tile-drag-handle'))
  const viewport = page.viewportSize() ?? { width: 1280, height: 720 }
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await page.mouse.down()
  await page.mouse.move(viewport.width - 40, handle.y + handle.height / 2, { steps: 20 })
  await page.mouse.up()

  await expect(async () => {
    expect((await boxOf(collections)).x).toBeGreaterThan((await boxOf(routes)).x)
  }).toPass()

  // After a reload the moved position is read back from localStorage, not reset to default.
  await page.reload()
  await expect(async () => {
    expect((await boxOf(collections)).x).toBeGreaterThan((await boxOf(routes)).x)
  }).toPass()
})

test('a stale version migrates: unknown tiles drop, new tiles appear, all six render', async ({
  page,
}) => {
  // An older save: a now-removed tile, only two known tiles, missing the other four.
  await seedLayout(page, {
    version: 0,
    layouts: {
      lg: [
        { i: 'obsolete-tile', x: 0, y: 0, w: 4, h: 6 },
        { i: 'collections', x: 0, y: 0, w: 3, h: 6 },
        { i: 'routes', x: 3, y: 0, w: 5, h: 6 },
      ],
    },
    hidden: ['obsolete-tile'],
  })
  await page.goto('/')

  // Every current tile renders — the four missing ones were appended at their default slot.
  await expect(page.getByTestId('tile-collections')).toBeVisible()
  await expect(page.getByTestId('tile-current-routes')).toBeVisible()
  await expect(page.getByTestId('tile-routes')).toBeVisible()
  await expect(page.getByTestId('tile-route-detail')).toBeVisible()
  await expect(page.getByTestId('tile-logs')).toBeVisible()
  await expect(page.getByTestId('tile-sessions')).toBeVisible()

  // The unknown tile was dropped, not rendered as an empty cell.
  await expect(page.getByTestId('tile-obsolete-tile')).toHaveCount(0)
})

test('corrupt saved data falls back silently to the default layout', async ({ page }) => {
  await seedLayout(page, '{ this is not valid json')
  await page.goto('/')

  // No crash — the default arrangement renders: Collections left of Routes left of Logs.
  await expect(page.getByTestId('dashboard')).toBeVisible()
  const left = await boxOf(page.getByTestId('tile-collections'))
  const center = await boxOf(page.getByTestId('tile-routes'))
  const right = await boxOf(page.getByTestId('tile-logs'))
  expect(left.x).toBeLessThan(center.x)
  expect(center.x).toBeLessThan(right.x)
})

test('the reset-layout control restores the default arrangement', async ({ page }) => {
  await seedLayout(page, { version: 1, layouts: { lg: SWAPPED_LG }, hidden: [] })
  await page.goto('/')
  await enableEditMode(page) // reset is a mutational control, shown only in edit mode (#92)

  const collections = page.getByTestId('tile-collections')
  const routes = page.getByTestId('tile-routes')

  // Starts swapped (Collections right of Routes), per the seeded layout.
  await expect(async () => {
    expect((await boxOf(collections)).x).toBeGreaterThan((await boxOf(routes)).x)
  }).toPass()

  await page.getByTestId('reset-layout').click()

  // Reset restores the default: Collections back to the left of Routes.
  await expect(async () => {
    expect((await boxOf(collections)).x).toBeLessThan((await boxOf(routes)).x)
  }).toPass()
})

// Slice 4 (#92): the edit-mode gate. The dashboard boots locked — tiles can't be moved or
// resized and every inner control stays interactive for normal use. A top-bar Edit layout
// toggle unlocks drag/resize and surfaces the mutational controls (reset). Edit mode is
// ephemeral: it always boots off, never persisted. We assert user-visible affordances —
// the corner resize handle, which RGL keeps in the DOM but hides (`display:none` via its
// `react-resizable-hide` class) when an item isn't resizable, and the reset control's
// presence — not RGL internals.

test('the dashboard boots locked: no resize handles, reset hidden, inner controls clickable', async ({
  page,
}) => {
  await page.goto('/')

  // The Edit layout toggle exists and reads as off.
  const editToggle = page.getByTestId('edit-layout')
  await expect(editToggle).toBeVisible()
  await expect(editToggle).toHaveText('edit layout')
  await expect(editToggle).toHaveAttribute('aria-pressed', 'false')

  // Locked: the corner resize handles are hidden, and the mutational reset control is gone.
  await expect(page.locator('.react-resizable-handle').first()).toBeHidden()
  await expect(page.getByTestId('reset-layout')).toHaveCount(0)

  // Inner controls are fully clickable for normal use — pausing flips the button label.
  const pause = page.getByTestId('logs-pause')
  await expect(pause).toHaveText('pause')
  await pause.click()
  await expect(pause).toHaveText('resume')
})

test('toggling edit on reveals drag/resize affordances and the reset control; off hides them', async ({
  page,
}) => {
  await page.goto('/')

  // Off → on: resize corners become active and reset surfaces.
  await enableEditMode(page)
  await expect(page.getByTestId('edit-layout')).toHaveText('done')
  await expect(page.getByTestId('edit-layout')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.react-resizable-handle').first()).toBeVisible()
  await expect(page.getByTestId('reset-layout')).toBeVisible()

  // On → off: the affordances and the reset control disappear again (plain panel restored).
  await page.getByTestId('edit-layout').click()
  await expect(page.getByTestId('edit-layout')).toHaveText('edit layout')
  await expect(page.locator('.react-resizable-handle').first()).toBeHidden()
  await expect(page.getByTestId('reset-layout')).toHaveCount(0)

  // Normal use is unaffected once locked again.
  const pause = page.getByTestId('logs-pause')
  await pause.click()
  await expect(pause).toHaveText('resume')
})

test('edit mode is ephemeral: a reload always boots locked', async ({ page }) => {
  await page.goto('/')

  await enableEditMode(page)
  await expect(page.getByTestId('reset-layout')).toBeVisible()

  // A reload starts fresh in locked mode regardless of the prior edit state.
  await page.reload()
  await expect(page.getByTestId('edit-layout')).toHaveText('edit layout')
  await expect(page.getByTestId('edit-layout')).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator('.react-resizable-handle').first()).toBeHidden()
  await expect(page.getByTestId('reset-layout')).toHaveCount(0)
})

// Slice 5 (#94): show/hide tiles. In edit mode each tile carries a close "×" that removes
// it from the grid; a hidden-tiles menu re-adds a closed tile at its default slot. Tile
// visibility is part of the persisted `{ version, layouts, hidden }` object, so a closed
// tile stays closed across reloads (the "logs-only / routes-only workspace" capability).
// The close controls and the menu are mutational, so they only surface in edit mode.

test('the close control and hidden-tiles menu surface only in edit mode', async ({ page }) => {
  await page.goto('/')

  // Locked: no close controls on tiles, no hidden-tiles menu.
  await expect(page.getByTestId('tile-close-logs')).toHaveCount(0)
  await expect(page.getByTestId('hidden-tiles-menu')).toHaveCount(0)

  // Edit on: every visible tile gets a close control and the menu appears.
  await enableEditMode(page)
  await expect(page.getByTestId('tile-close-logs')).toBeVisible()
  await expect(page.getByTestId('hidden-tiles-menu')).toBeVisible()
})

test('closing a tile removes it; the hidden-tiles menu re-adds it', async ({ page }) => {
  await page.goto('/')
  await enableEditMode(page)

  // All six render to start; the other tiles are unaffected by what follows.
  await expect(page.getByTestId('tile-logs')).toBeVisible()
  await expect(page.getByTestId('tile-collections')).toBeVisible()
  await expect(page.getByTestId('tile-routes')).toBeVisible()

  // Close Logs: it leaves the grid entirely (not just hidden via CSS).
  await page.getByTestId('tile-close-logs').click()
  await expect(page.getByTestId('tile-logs')).toHaveCount(0)
  // The rest of the arrangement survives — collections and routes still render.
  await expect(page.getByTestId('tile-collections')).toBeVisible()
  await expect(page.getByTestId('tile-routes')).toBeVisible()

  // The hidden-tiles menu now lists Logs; re-adding brings it back into the grid.
  await page.getByTestId('hidden-tiles-menu').click()
  await page.getByTestId('show-tile-logs').click()
  await expect(page.getByTestId('tile-logs')).toBeVisible()
  // Re-adding consumes the entry — the menu no longer offers it.
  await page.getByTestId('hidden-tiles-menu').click()
  await expect(page.getByTestId('show-tile-logs')).toHaveCount(0)
})

test('a hidden tile stays hidden across a reload', async ({ page }) => {
  await page.goto('/')
  await enableEditMode(page)

  await page.getByTestId('tile-close-sessions').click()
  await expect(page.getByTestId('tile-sessions')).toHaveCount(0)

  // The hidden set is persisted, so a fresh load boots with Sessions still closed.
  await page.reload()
  await expect(page.getByTestId('dashboard')).toBeVisible()
  await expect(page.getByTestId('tile-sessions')).toHaveCount(0)
  // The other tiles are unaffected.
  await expect(page.getByTestId('tile-collections')).toBeVisible()
})

test('a seeded hidden set is honored on boot', async ({ page }) => {
  // A returning user whose saved layout has Logs closed: the grid boots without it.
  await seedLayout(page, { version: 1, layouts: { lg: SWAPPED_LG }, hidden: ['logs'] })
  await page.goto('/')

  await expect(page.getByTestId('dashboard')).toBeVisible()
  await expect(page.getByTestId('tile-logs')).toHaveCount(0)
  // Every other tile renders.
  await expect(page.getByTestId('tile-collections')).toBeVisible()
  await expect(page.getByTestId('tile-sessions')).toBeVisible()

  // Edit mode surfaces it in the menu, and re-adding restores it.
  await enableEditMode(page)
  await page.getByTestId('hidden-tiles-menu').click()
  await page.getByTestId('show-tile-logs').click()
  await expect(page.getByTestId('tile-logs')).toBeVisible()
})
