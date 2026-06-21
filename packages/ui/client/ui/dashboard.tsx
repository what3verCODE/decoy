import { useUnit } from 'effector-react'
import type { ComponentChildren, JSX } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import type { LayoutItem } from 'react-grid-layout'
import { Responsive, useContainerWidth } from 'react-grid-layout'
import { layoutModel } from '../model'
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
// and surfaces the mutational controls (reset, and later close/re-add). Tiles drag by
// their header only (`.tile-drag-handle`) and carry minW/minH so nothing collapses.

// The header doubles as the drag handle; the header buttons (back, pause, clear, reset…)
// must stay clickable, so they cancel a drag.
const DRAG_CONFIG: DragConfig = {
  handle: '.tile-drag-handle',
  cancel: 'button,select,textarea,input,a',
}

const COLS = 12
const ROWS = 12
const MARGIN = 8

/** Outer chrome every tile shares: fills its grid cell, clips overflow, rounded border. */
const TILE = 'h-full overflow-hidden rounded-md border border-border bg-card'

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
  const [items, editing, handleLayoutChange] = useUnit([
    layoutModel.$items,
    layoutModel.$editing,
    layoutModel.moved,
  ])

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
          <div key="collections" class={TILE} data-testid="tile-collections">
            <CollectionsPanel />
          </div>
          <div key="current-routes" class={TILE} data-testid="tile-current-routes">
            <CurrentRoutesPanel />
          </div>
          <div key="routes" class={TILE} data-testid="tile-routes">
            <RoutesCatalog />
          </div>
          <div key="route-detail" class={TILE} data-testid="tile-route-detail">
            <RouteDetail />
          </div>
          <div key="logs" class={TILE} data-testid="tile-logs">
            <LiveStream />
          </div>
          <div key="sessions" class={TILE} data-testid="tile-sessions">
            <SessionsPanel />
          </div>
        </ResponsiveGridLayout>
      )}
    </div>
  )
}
