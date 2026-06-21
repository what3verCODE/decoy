import { useUnit } from 'effector-react'
import type { ComponentChildren, JSX } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import type { LayoutItem } from 'react-grid-layout'
import { Responsive, useContainerWidth } from 'react-grid-layout'
import { layoutModel } from '../model'
import { TILE_LABELS } from '../model/create-layout-model'
import { CollectionsPanel } from './collections-panel'
import { CurrentRoutesPanel } from './current-routes-panel'
import { LiveStream } from './live-stream'
import { RouteDetail } from './route-detail'
import { RoutesCatalog } from './routes-catalog'
import { SessionsPanel } from './sessions-panel'

// react-grid-layout ships @types/react types; under preact/compat the React JSX element
// types clash with Preact's (the runtime is identical — only the type shapes differ).
// Re-type the Responsive grid against the prop subset we use with Preact's own children
// type, so our call site stays type-checked without fighting React's JSX.
// `DragConfig` isn't re-exported from the package entry, so we declare the subset we set.
type DragConfig = { handle?: string; cancel?: string; enabled?: boolean }
type ResizeConfig = { enabled?: boolean }
type ResponsiveGridProps = {
  className?: string
  width: number
  layouts: Record<string, LayoutItem[]>
  breakpoints: Record<string, number>
  cols: Record<string, number>
  rowHeight?: number
  margin?: [number, number]
  containerPadding?: [number, number]
  dragConfig?: DragConfig
  resizeConfig?: ResizeConfig
  onLayoutChange?: (layout: readonly LayoutItem[]) => void
  children?: ComponentChildren
}
const ResponsiveGridLayout = Responsive as unknown as (props: ResponsiveGridProps) => JSX.Element

// Slice 2 (#90): the six reactive tiles — Collections, Current routes, Routes, Route
// detail, Logs, Sessions — each driven by its existing effector model so it reflects
// live control-plane state wherever it sits. Slice 3 (#91): the arrangement (and its
// default) now lives in `layoutModel`, which persists every move/resize to localStorage
// and reloads with migration; the reset-layout control lives in the top bar. Slice 4
// (#92): an edit-mode gate (`layoutModel.$editing`) drives the grid's drag/resize. The
// dashboard boots locked — off — so tiles can't be moved or resized and inner controls
// stay fully clickable; turning edit on activates header drag and the corner resize handle
// and surfaces the mutational controls. Tiles drag by their header only
// (`.tile-drag-handle`) and carry minW/minH so nothing collapses. Slice 5 (#94): each tile
// carries a close control (shown in edit mode) that hides it; only the visible tiles
// (`layoutModel.$items`) are rendered, so the grid never auto-places a hidden one. The
// hidden-tiles menu that re-adds a closed tile lives in the top bar.

// The header doubles as the drag handle; the header buttons (back, pause, clear, reset…)
// and the close control must stay clickable, so they cancel a drag.
const DRAG_CONFIG: DragConfig = {
  handle: '.tile-drag-handle',
  cancel: 'button,select,textarea,input,a',
}

// The six tiles, keyed by their layout id. The grid renders the subset that isn't hidden;
// each child's key matches its layout item so react-grid-layout can place it.
const TILES: { id: string; testid: string; render: () => JSX.Element }[] = [
  { id: 'collections', testid: 'tile-collections', render: () => <CollectionsPanel /> },
  { id: 'current-routes', testid: 'tile-current-routes', render: () => <CurrentRoutesPanel /> },
  { id: 'routes', testid: 'tile-routes', render: () => <RoutesCatalog /> },
  { id: 'route-detail', testid: 'tile-route-detail', render: () => <RouteDetail /> },
  { id: 'logs', testid: 'tile-logs', render: () => <LiveStream /> },
  { id: 'sessions', testid: 'tile-sessions', render: () => <SessionsPanel /> },
]

const COLS = 12
const ROWS = 12
const MARGIN = 8

/** Outer chrome every tile shares: fills its grid cell, clips overflow, rounded border.
 * `relative` anchors the edit-mode close control to the tile's top-right corner. */
const TILE = 'relative h-full overflow-hidden rounded-md border border-border bg-card'

/**
 * The edit-mode close control: a small × in the tile's top-right corner that hides the
 * tile. Rendered only in edit mode and only over its own tile; it's a `<button>`, so the
 * drag config's `cancel` list keeps a click from starting a drag on the header beneath it.
 */
function CloseTile({ id }: { id: string }): JSX.Element {
  const handleHide = useUnit(layoutModel.hide)
  const label = TILE_LABELS[id] ?? id
  return (
    <button
      type="button"
      onClick={() => handleHide(id)}
      data-testid={`tile-close-${id}`}
      title={`Hide ${label}`}
      aria-label={`Hide ${label}`}
      class="absolute top-1 right-1 z-10 flex items-center justify-center w-5 h-5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
    >
      <span aria-hidden="true" class="text-[13px] leading-none">
        ×
      </span>
    </button>
  )
}

/**
 * Derive a rowHeight that makes the {@link ROWS}-row grid fill the available height,
 * so full-height tiles (h: ROWS) span the viewport like today's flex columns.
 * react-grid-layout's `useContainerWidth` tracks width; height is ours to measure.
 */
function useRowHeight(ref: { current: HTMLElement | null }): number {
  const [rowHeight, setRowHeight] = useState(40)
  useEffect(() => {
    const element = ref.current
    if (!element) {
      return
    }
    const measure = () => {
      const height = element.clientHeight
      // RGL stacks ROWS rows with a MARGIN gap between each and at the container edges.
      const usable = height - MARGIN * (ROWS + 1)
      setRowHeight(Math.max(20, usable / ROWS))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return rowHeight
}

export function Dashboard(): JSX.Element {
  // 2.x replaced the WidthProvider HOC with a hook: it observes the container and gives
  // back its measured width (plus the ref to attach). `mounted` gates the first paint so
  // the grid lays out at the real width instead of the hook's default fallback.
  const { width, containerRef, mounted } = useContainerWidth()
  const rowHeight = useRowHeight(containerRef)
  const [items, hidden, editing, handleLayoutChange] = useUnit([
    layoutModel.$items,
    layoutModel.$hidden,
    layoutModel.$editing,
    layoutModel.moved,
  ])

  // Render exactly the visible tiles — matching the grid's `items` (`$items` filters the
  // same `hidden` set), so react-grid-layout never sees a child it can't place.
  const visibleTiles = TILES.filter((tile) => !hidden.includes(tile.id))

  return (
    <div
      ref={containerRef}
      class={`flex-1 min-h-0 overflow-hidden${editing ? ' dashboard-editing' : ''}`}
      data-testid="dashboard"
    >
      {mounted && (
        <ResponsiveGridLayout
          className="layout"
          width={width}
          layouts={{ lg: items }}
          breakpoints={{ lg: 0 }}
          cols={{ lg: COLS }}
          rowHeight={rowHeight}
          margin={[MARGIN, MARGIN]}
          containerPadding={[MARGIN, MARGIN]}
          dragConfig={{ ...DRAG_CONFIG, enabled: editing }}
          resizeConfig={{ enabled: editing }}
          onLayoutChange={handleLayoutChange}
        >
          {visibleTiles.map((tile) => (
            <div key={tile.id} class={TILE} data-testid={tile.testid}>
              {editing && <CloseTile id={tile.id} />}
              {tile.render()}
            </div>
          ))}
        </ResponsiveGridLayout>
      )}
    </div>
  )
}
