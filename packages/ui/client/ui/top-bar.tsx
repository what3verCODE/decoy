import { useUnit } from 'effector-react'
import type { JSX } from 'preact'
import { layoutModel, routesModel, servicesModel } from '../model'

/**
 * The service axis switcher (ADR-0017): pick which booted instance the catalog /
 * collection / override controls target. Rendered whenever the aggregator reports
 * any service — a single-instance config shows one (selected) entry. The logs view
 * stays aggregated across services and is unaffected by the selection.
 */
function ServiceSwitcher(): JSX.Element | null {
  const [list, active, handleSwitchTo] = useUnit([
    servicesModel.$services,
    servicesModel.$active,
    servicesModel.switchTo,
  ])
  if (list.length === 0) {
    return null
  }
  return (
    <label class="flex items-center gap-1.5 ml-2 text-[11px] text-muted-foreground">
      <span class="uppercase tracking-wider">service</span>
      <select
        data-testid="service-switcher"
        value={active ?? ''}
        onChange={(event) => handleSwitchTo((event.currentTarget as HTMLSelectElement).value)}
        class="h-[22px] px-1.5 rounded border border-border bg-muted/60 text-foreground text-[11px]"
      >
        {list.map((service) => (
          <option key={service.name} value={service.name}>
            {service.name}
          </option>
        ))}
      </select>
    </label>
  )
}

export function TopBar(): JSX.Element {
  const [routes, handleResetLayout] = useUnit([routesModel.$routes, layoutModel.reset])
  return (
    <header class="flex items-center gap-3 h-12 px-4 border-b border-border bg-card shrink-0">
      <span class="font-semibold tracking-tight text-foreground select-none">decoy</span>
      <span class="text-[11px] uppercase tracking-wider text-muted-foreground px-1.5 py-0.5 rounded bg-muted">
        control panel
      </span>
      <ServiceSwitcher />
      <div class="flex-1" />
      <span class="text-muted-foreground">
        <span class="text-foreground tabular-nums">{routes.length}</span> routes
      </span>
      <button
        type="button"
        onClick={handleResetLayout}
        data-testid="reset-layout"
        class="text-[11px] px-1.5 h-[22px] rounded border border-border text-muted-foreground hover:bg-muted/60 transition-colors"
      >
        reset layout
      </button>
    </header>
  )
}
