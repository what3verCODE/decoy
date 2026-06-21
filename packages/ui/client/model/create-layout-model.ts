import { createEffect, createEvent, createStore, sample } from 'effector'
import type { LayoutItem } from 'react-grid-layout'

// Slice 3 (#91): the dashboard layout is local-first. A single serializable object —
// `{ version, layouts, hidden }` — is the source of truth, owned by this effector model
// (same `create-*-model` shape as the rest). It persists to localStorage on every
// move/resize and reloads with graceful migration. The schema is transport-agnostic: the
// model only ever hands a JSON string to a {@link LayoutTransport}, so a future opt-in
// sync to `.decoy/settings.json` is a transport swap, not a redesign. `hidden` is part of
// the shape now (the SSOT is stable) though show/hide behaviour lands in #94.

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
function sameSlots(a: readonly LayoutItem[], b: readonly LayoutItem[]): boolean {
  if (a.length !== b.length) {
    return false
  }
  const index = new Map(a.map((item) => [item.i, item]))
  return b.every((item) => {
    const prev = index.get(item.i)
    return (
      prev != null &&
      prev.x === item.x &&
      prev.y === item.y &&
      prev.w === item.w &&
      prev.h === item.h
    )
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

  const $items = $layout.map((layout) => layout.layouts.lg)

  sample({
    clock: moved,
    source: $layout,
    filter: (layout, items) => !sameSlots(layout.layouts.lg, items),
    fn: (layout, items) => ({
      ...layout,
      layouts: { ...layout.layouts, lg: reconcileItems(items) },
    }),
    target: $layout,
  })

  sample({
    clock: reset,
    fn: defaultLayout,
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
    $editing,

    moved,
    reset,
    toggleEditing,
  }
}
