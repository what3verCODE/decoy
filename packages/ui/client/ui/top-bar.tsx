import type { JSX } from 'preact'
import { routeCount } from '../model/routes'

export function TopBar(): JSX.Element {
  return (
    <header class="flex items-center gap-3 h-12 px-4 border-b border-border bg-card shrink-0">
      <span class="font-semibold tracking-tight text-foreground select-none">decoy</span>
      <span class="text-[11px] uppercase tracking-wider text-muted-foreground px-1.5 py-0.5 rounded bg-muted">
        control panel
      </span>
      <div class="flex-1" />
      <span class="text-muted-foreground">
        <span class="text-foreground tabular-nums">{routeCount.value}</span> routes
      </span>
    </header>
  )
}
