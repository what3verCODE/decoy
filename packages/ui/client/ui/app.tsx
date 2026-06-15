import type { JSX } from 'preact'
import { CollectionsPanel } from './collections-panel'
import { LiveStream } from './live-stream'
import { RoutesCatalog } from './routes-catalog'
import { TopBar } from './top-bar'

export function App(): JSX.Element {
  return (
    <div class="h-full flex flex-col bg-background text-foreground">
      <TopBar />
      <div class="flex-1 flex min-h-0">
        <CollectionsPanel />
        <RoutesCatalog />
        <LiveStream />
      </div>
    </div>
  )
}
