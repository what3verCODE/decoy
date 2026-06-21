import { useUnit } from 'effector-react'
import type { ComponentChildren, JSX } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import type { LayoutItem } from 'react-grid-layout'
import { Responsive, useContainerWidth } from 'react-grid-layout'
import { $view, routeModel } from '../model'
import { CollectionsPanel } from './collections-panel'
import { LiveStream } from './live-stream'
import { RouteDetail } from './route-detail'
import { RoutesCatalog } from './routes-catalog'
import { SessionsPanel } from './sessions-panel'

// react-grid-layout ships @types/react types; under preact/compat the React JSX element
// types clash with Preact's (the runtime is identical — only the type shapes differ).
// Re-type the Responsive grid against the prop subset we use with Preact's own children
// type, so our call site stays type-checked without fighting React's JSX.
// `DragConfig` isn't re-exported from the package entry, so we declare the subset we set.
type DragConfig = { handle?: string; cancel?: string }
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
  onLayoutChange?: (layout: readonly LayoutItem[]) => void
  children?: ComponentChildren
}
const ResponsiveGridLayout = Responsive as unknown as (props: ResponsiveGridProps) => JSX.Element

// Slice 1 (#89): a hardcoded 12-col grid whose default arrangement mirrors today's
// spatial layout — Collections left, the catalog/detail/sessions Center in the middle,
// Logs right. No persistence yet (#91); drag/resize are always on (the edit-mode gate
// is #92). Tiles drag by their header only (`.tile-drag-handle`) and carry minW/minH
// so nothing collapses to an unreadable sliver. Vertical compaction is the grid default.
const LAYOUT: LayoutItem[] = [
  { i: 'collections', x: 0, y: 0, w: 3, h: 12, minW: 2, minH: 4 },
  { i: 'center', x: 3, y: 0, w: 5, h: 12, minW: 3, minH: 4 },
  { i: 'logs', x: 8, y: 0, w: 4, h: 12, minW: 2, minH: 4 },
]

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

/** The center tile content: the sessions inspector, or the catalog / drilled route detail. */
function Center(): JSX.Element {
  const [view, route] = useUnit([$view, routeModel.$route])
  if (view === 'sessions') {
    return <SessionsPanel />
  }
  return route ? <RouteDetail /> : <RoutesCatalog />
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

  return (
    <div ref={containerRef} class="flex-1 min-h-0 overflow-hidden" data-testid="dashboard">
      {mounted && (
        <ResponsiveGridLayout
          className="layout"
          width={width}
          layouts={{ lg: LAYOUT }}
          breakpoints={{ lg: 0 }}
          cols={{ lg: COLS }}
          rowHeight={rowHeight}
          margin={[MARGIN, MARGIN]}
          containerPadding={[MARGIN, MARGIN]}
          dragConfig={DRAG_CONFIG}
        >
          <div key="collections" class={TILE} data-testid="tile-collections">
            <CollectionsPanel />
          </div>
          <div key="center" class={TILE} data-testid="tile-center">
            <Center />
          </div>
          <div key="logs" class={TILE} data-testid="tile-logs">
            <LiveStream />
          </div>
        </ResponsiveGridLayout>
      )}
    </div>
  )
}
