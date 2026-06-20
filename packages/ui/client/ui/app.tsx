import { useGate, useUnit } from 'effector-react'
import type { JSX } from 'preact'
import { $view, PageGate, routeModel } from '../model'
import { CollectionsPanel } from './collections-panel'
import { LiveStream } from './live-stream'
import { RouteDetail } from './route-detail'
import { RoutesCatalog } from './routes-catalog'
import { SessionsPanel } from './sessions-panel'
import { TopBar } from './top-bar'

/** The center view: the sessions inspector, or the routes catalog / drilled-in route detail. */
function Center(): JSX.Element {
  const [view, route] = useUnit([$view, routeModel.$route])
  if (view === 'sessions') {
    return <SessionsPanel />
  }
  return route ? <RouteDetail /> : <RoutesCatalog />
}

export function App(): JSX.Element {
  useGate(PageGate)

  return (
    <div class="h-full flex flex-col bg-background text-foreground">
      <TopBar />
      <div class="flex-1 flex min-h-0">
        <CollectionsPanel />
        <Center />
        <LiveStream />
      </div>
    </div>
  )
}
