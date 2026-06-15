import type { JSX } from 'preact'
import { routeCount } from '../model/routes'
import { activeService, services, switchService } from '../model/services'
import { loadSessions } from '../model/sessions'
import { showCatalog, showSessions, type View, view } from '../model/view'

function NavButton({ target, label }: { target: View; label: string }): JSX.Element {
  const active = view.value === target
  return (
    <button
      type="button"
      data-testid={`nav-${target}`}
      data-active={active ? 'true' : 'false'}
      onClick={() => {
        if (target === 'sessions') {
          showSessions()
          void loadSessions()
        } else {
          showCatalog()
        }
      }}
      class={`text-[11px] px-2 h-[22px] rounded border transition-colors ${
        active
          ? 'border-emerald bg-muted/60 text-foreground'
          : 'border-border text-muted-foreground hover:bg-muted/60'
      }`}
    >
      {label}
    </button>
  )
}

/**
 * The service axis switcher (ADR-0017): pick which booted instance the catalog /
 * collection / override controls target. Rendered whenever the aggregator reports
 * any service — a single-instance config shows one (selected) entry. The logs view
 * stays aggregated across services and is unaffected by the selection.
 */
function ServiceSwitcher(): JSX.Element | null {
  const list = services.value
  if (list.length === 0) {
    return null
  }
  return (
    <label class="flex items-center gap-1.5 ml-2 text-[11px] text-muted-foreground">
      <span class="uppercase tracking-wider">service</span>
      <select
        data-testid="service-switcher"
        value={activeService.value}
        onChange={(event) => void switchService((event.currentTarget as HTMLSelectElement).value)}
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
  return (
    <header class="flex items-center gap-3 h-12 px-4 border-b border-border bg-card shrink-0">
      <span class="font-semibold tracking-tight text-foreground select-none">decoy</span>
      <span class="text-[11px] uppercase tracking-wider text-muted-foreground px-1.5 py-0.5 rounded bg-muted">
        control panel
      </span>
      <ServiceSwitcher />
      <nav class="flex items-center gap-1.5 ml-2">
        <NavButton target="catalog" label="catalog" />
        <NavButton target="sessions" label="sessions" />
      </nav>
      <div class="flex-1" />
      <span class="text-muted-foreground">
        <span class="text-foreground tabular-nums">{routeCount.value}</span> routes
      </span>
    </header>
  )
}
