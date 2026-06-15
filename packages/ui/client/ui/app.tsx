import type { JSX } from 'preact'
import { selectedRouteId } from '../model/route-detail'
import { CollectionsPanel } from './collections-panel'
import { LiveStream } from './live-stream'
import { RouteDetail } from './route-detail'
import { RoutesCatalog } from './routes-catalog'
import { TopBar } from './top-bar'

export function App(): JSX.Element {
  return (
    <div class="h-full flex flex-col bg-background text-foreground">
      <TopBar />
      <div class="flex-1 flex min-h-0">
        <CollectionsPanel />
        {selectedRouteId.value ? <RouteDetail /> : <RoutesCatalog />}
        <LiveStream />
      </div>
    </div>
  )
}
