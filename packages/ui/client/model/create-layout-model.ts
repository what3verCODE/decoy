import { createEffect, createEvent, createStore, sample } from 'effector'
import type { LayoutItem } from 'react-grid-layout'

// Slice 3 (#91): the dashboard layout is local-first. A single serializable object —
// `{ version, layouts, hidden }` — is the source of truth, owned by this effector model
// (same `create-*-model` shape as the rest). It persists to localStorage on every
// move/resize and reloads with graceful migration. The schema is transport-agnostic: the
// model only ever hands a JSON string to a {@link LayoutTransport}, so a future opt-in
// sync to `.decoy/settings.json` is a transport swap, not a redesign.
//
// Slice 5 (#94): `hidden` now drives behaviour. A tile's close control adds its id to the
// set (`hide`); the hidden-tiles menu re-adds one (`show`) at its default slot/size. The
// grid only ever sees the *visible* tiles (`$items` filters `hidden` out), and the
// dashboard renders only those children — RGL auto-places any child it can't match to a
// layout item, so a hidden tile must be absent from both. Hidden state lives in the
// persisted object, so a closed tile stays closed across reloads.

/** Bump when the default arrangement changes shape; an older saved version migrates. */
export const LAYOUT_VERSION = 1
export const LAYOUT_STORAGE_KEY = 'decoy.dashboard.layout'

// The default arrangement (was inline in dashboard.tsx): Collections over Current routes
// on the left, Routes over Route detail in the center, Logs over Sessions on the right.
// Each tile carries minW/minH so nothing collapses to an unreadable sliver. This is also
// the registry of *known* tiles — migration drops anything not listed and appends anything
// listed but missing from saved data.
export const DEFAULT_LAYOUT: LayoutItem[] = [
  { i: 'collections', x: 0, y: 0, w: 3, h: 6, minW: 2, minH: 3 },
  { i: 'current-routes', x: 0, y: 6, w: 3, h: 6, minW: 2, minH: 3 },
  { i: 'routes', x: 3, y: 0, w: 5, h: 6, minW: 3, minH: 3 },
  { i: 'route-detail', x: 3, y: 6, w: 5, h: 6, minW: 3, minH: 3 },
  { i: 'logs', x: 8, y: 0, w: 4, h: 6, minW: 2, minH: 3 },
  { i: 'sessions', x: 8, y: 6, w: 4, h: 6, minW: 2, minH: 3 },
]

// Human-readable tile names, used by the close control's label and the hidden-tiles menu.
// Keyed by the same ids as DEFAULT_LAYOUT — the canonical tile registry.
export const TILE_LABELS: Record<string, string> = {
  collections: 'Collections',
  'current-routes': 'Current routes',
  routes: 'Routes',
  'route-detail': 'Route detail',
  logs: 'Logs',
  sessions: 'Sessions',
}

/** The whole dashboard layout as a single serializable object — the source of truth. */
export type DashboardLayout = {
  version: number
  // Keyed by breakpoint; the grid runs a single `lg` breakpoint today.
  layouts: { lg: LayoutItem[] }
  hidden: string[]
}

const KNOWN = new Map(DEFAULT_LAYOUT.map((item) => [item.i, item]))

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

// Snap a candidate item onto its known default so tile constraints (minW/minH) always
// survive a round-trip — we take only position/size from the candidate, never its
// constraints (react-grid-layout's onLayoutChange and hand-seeded data may omit them).
function mergeItem(base: LayoutItem, item: Partial<LayoutItem>): LayoutItem {
  return {
    ...base,
    x: num(item.x, base.x),
    y: num(item.y, base.y),
    w: num(item.w, base.w),
    h: num(item.h, base.h),
  }
}

// Reconcile arbitrary items against the known tile set: keep known tiles (deduped) in
// their saved slot, then append any newly-introduced tile at its default slot. Unknown
// ids fall away. This is the whole migration: it runs on every load so a stale `version`,
// a renamed tile, or a brand-new one all resolve to a renderable layout instead of crashing.
function reconcileItems(items: readonly Partial<LayoutItem>[]): LayoutItem[] {
  const kept: LayoutItem[] = []
  const present = new Set<string>()
  for (const item of items) {
    const base = item?.i != null ? KNOWN.get(item.i) : undefined
    if (!base || present.has(base.i)) {
      continue
    }
    kept.push(mergeItem(base, item))
    present.add(base.i)
  }
  for (const base of DEFAULT_LAYOUT) {
    if (!present.has(base.i)) {
      kept.push({ ...base })
    }
  }
  return kept
}

/** The pristine default layout (a fresh copy each call). */
export function defaultLayout(): DashboardLayout {
  return { version: LAYOUT_VERSION, layouts: { lg: reconcileItems(DEFAULT_LAYOUT) }, hidden: [] }
}

// Bring a parsed-but-untrusted value up to the current shape. Anything non-conforming
// degrades to a default rather than throwing — corrupt data must never break the panel.
function migrate(parsed: unknown): DashboardLayout {
  if (parsed == null || typeof parsed !== 'object') {
    return defaultLayout()
  }
  const candidate = parsed as Partial<DashboardLayout>
  const items = Array.isArray(candidate.layouts?.lg) ? candidate.layouts.lg : []
  const hidden = Array.isArray(candidate.hidden)
    ? candidate.hidden.filter((id): id is string => typeof id === 'string' && KNOWN.has(id))
    : []
  return { version: LAYOUT_VERSION, layouts: { lg: reconcileItems(items) }, hidden }
}

/**
 * The persistence seam: read/write an opaque string. localStorage today; swapping in a
 * `.decoy/settings.json`-backed transport later is the whole of a future sync feature.
 */
export type LayoutTransport = {
  read(): string | null
  write(value: string): void
}

export function localStorageTransport(key: string): LayoutTransport {
  return {
    read() {
      if (typeof localStorage === 'undefined') {
        return null
      }
      try {
        return localStorage.getItem(key)
      } catch {
        return null
      }
    },
    write(value) {
      if (typeof localStorage === 'undefined') {
        return
      }
      try {
        localStorage.setItem(key, value)
      } catch {
        // Quota exceeded or storage denied — the in-memory layout still works this session.
      }
    },
  }
}

function readLayout(transport: LayoutTransport): DashboardLayout {
  const raw = transport.read()
  if (raw == null) {
    return defaultLayout()
  }
  try {
    return migrate(JSON.parse(raw))
  } catch {
    return defaultLayout()
  }
}

// Did the grid actually re-arrange? react-grid-layout fires onLayoutChange on mount with
// the layout we just gave it — gating on a real position change avoids a needless write
// (and the prop->event->prop feedback loop that would otherwise re-render every frame).
// The grid only ever reports the *visible* tiles, so we compare each incoming item against
// its stored slot rather than comparing array lengths (a hidden tile is legitimately absent).
function movedAny(current: readonly LayoutItem[], incoming: readonly LayoutItem[]): boolean {
  const index = new Map(current.map((item) => [item.i, item]))
  return incoming.some((item) => {
    const prev = index.get(item.i)
    return (
      prev == null ||
      prev.x !== item.x ||
      prev.y !== item.y ||
      prev.w !== item.w ||
      prev.h !== item.h
    )
  })
}

// Fold the grid's reported (visible) positions back into the full layout, leaving any tile
// the grid didn't report — i.e. a currently-hidden one — at its stored slot. Constraints
// (minW/minH) come from the stored base via {@link mergeItem}, never from the grid event.
function applyMoves(current: readonly LayoutItem[], incoming: readonly LayoutItem[]): LayoutItem[] {
  const updates = new Map<string, Partial<LayoutItem>>()
  for (const item of incoming) {
    if (item?.i != null) {
      updates.set(item.i, item)
    }
  }
  return current.map((item) => {
    const update = updates.get(item.i)
    return update ? mergeItem(item, update) : item
  })
}

type LayoutModelDeps = {
  transport?: LayoutTransport
}

export function createLayoutModel({
  transport = localStorageTransport(LAYOUT_STORAGE_KEY),
}: LayoutModelDeps = {}) {
  const $layout = createStore<DashboardLayout>(readLayout(transport))

  // Edit-mode gate (#92): drives the grid's drag/resize and surfaces the mutational
  // layout controls. Deliberately *not* part of `$layout` — it lives outside the
  // persisted object so the dashboard always boots locked (off), never accidentally in
  // edit mode after a reload. The top-bar toggle flips it; reloads reset it.
  const $editing = createStore(false)
  const toggleEditing = createEvent()
  $editing.on(toggleEditing, (editing) => !editing)

  // The grid's onLayoutChange (a move or resize).
  const moved = createEvent<readonly LayoutItem[]>()
  // The reset-layout control.
  const reset = createEvent()
  // Show/hide a tile (#94): the close control hides; the hidden-tiles menu re-adds.
  const hide = createEvent<string>()
  const show = createEvent<string>()

  // What the grid renders: every known tile *except* the hidden ones. The dashboard renders
  // exactly these children, so the grid never has to auto-place a tile it can't match.
  const $items = $layout.map((layout) =>
    layout.layouts.lg.filter((item) => !layout.hidden.includes(item.i)),
  )
  // The currently-hidden tile ids, for the hidden-tiles menu.
  const $hidden = $layout.map((layout) => layout.hidden)

  sample({
    clock: moved,
    source: $layout,
    filter: (layout, items) => movedAny(layout.layouts.lg, items),
    fn: (layout, items) => ({
      ...layout,
      layouts: { ...layout.layouts, lg: applyMoves(layout.layouts.lg, items) },
    }),
    target: $layout,
  })

  sample({
    clock: reset,
    fn: defaultLayout,
    target: $layout,
  })

  // Hide: add a known, not-already-hidden tile to the set. Its slot stays in `layouts.lg`
  // untouched so the rest of the arrangement is undisturbed.
  sample({
    clock: hide,
    source: $layout,
    filter: (layout, id) => KNOWN.has(id) && !layout.hidden.includes(id),
    fn: (layout, id) => ({ ...layout, hidden: [...layout.hidden, id] }),
    target: $layout,
  })

  // Show: drop a tile from the hidden set and re-seat it at its default slot/size, so it
  // re-appears somewhere sensible regardless of where it sat before being hidden.
  sample({
    clock: show,
    source: $layout,
    filter: (layout, id) => layout.hidden.includes(id),
    fn: (layout, id) => {
      const base = KNOWN.get(id)
      return {
        ...layout,
        hidden: layout.hidden.filter((hiddenId) => hiddenId !== id),
        layouts: {
          ...layout.layouts,
          lg: layout.layouts.lg.map((item) => (item.i === id && base ? { ...base } : item)),
        },
      }
    },
    target: $layout,
  })

  const persistFx = createEffect((layout: DashboardLayout) => {
    transport.write(JSON.stringify(layout))
  })

  // Persist on every change ($layout as clock fires on updates, not on initial value).
  sample({ clock: $layout, target: persistFx })

  return {
    $layout,
    $items,
    $hidden,
    $editing,

    moved,
    reset,
    hide,
    show,
    toggleEditing,
  }
}
