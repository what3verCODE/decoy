import { useUnit } from 'effector-react'
import type { JSX } from 'preact'
import { layoutModel, routesModel, servicesModel } from '../model'
import { TILE_LABELS } from '../model/create-layout-model'

/**
 * The service axis switcher: pick which booted instance the catalog /
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

/**
 * The hidden-tiles menu (#94): a disclosure listing every closed tile, each re-addable at
 * its default slot. Shown only in edit mode, alongside the other mutational controls. The
 * trigger reads as a count so it's obvious whether anything is hidden; opening it lists the
 * tiles, or says so when none are.
 */
function HiddenTilesMenu(): JSX.Element {
  const [hidden, handleShow] = useUnit([layoutModel.$hidden, layoutModel.show])
  return (
    <details class="relative" data-testid="hidden-tiles-menu">
      <summary class="list-none text-[11px] px-1.5 h-[22px] flex items-center rounded border border-border text-muted-foreground hover:bg-muted/60 transition-colors cursor-pointer select-none">
        hidden tiles
        {hidden.length > 0 && (
          <span class="ml-1 tabular-nums text-foreground">{hidden.length}</span>
        )}
      </summary>
      <div class="absolute right-0 mt-1 z-20 min-w-40 py-1 rounded border border-border bg-card shadow-lg">
        {hidden.length === 0 ? (
          <p class="px-3 py-1.5 text-[11px] text-muted-foreground">no hidden tiles</p>
        ) : (
          hidden.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => handleShow(id)}
              data-testid={`show-tile-${id}`}
              class="w-full flex items-center gap-1.5 px-3 py-1.5 text-left text-[11px] text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
            >
              <span aria-hidden="true" class="text-emerald">
                +
              </span>
              {TILE_LABELS[id] ?? id}
            </button>
          ))
        )}
      </div>
    </details>
  )
}

export function TopBar(): JSX.Element {
  const [routes, editing, handleToggleEditing, handleResetLayout] = useUnit([
    routesModel.$routes,
    layoutModel.$editing,
    layoutModel.toggleEditing,
    layoutModel.reset,
  ])
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
      {/* Edit-mode gate (#92): the only always-present layout control. Off by default on
          every boot; turning it on unlocks drag/resize and surfaces the mutational
          controls below (reset, and later close/re-add). */}
      <button
        type="button"
        onClick={handleToggleEditing}
        data-testid="edit-layout"
        aria-pressed={editing}
        class={`text-[11px] px-1.5 h-[22px] rounded border transition-colors ${
          editing
            ? 'text-emerald border-emerald/40 bg-emerald/10'
            : 'border-border text-muted-foreground hover:bg-muted/60'
        }`}
      >
        {editing ? 'done' : 'edit layout'}
      </button>
      {editing && (
        <>
          <HiddenTilesMenu />
          <button
            type="button"
            onClick={handleResetLayout}
            data-testid="reset-layout"
            class="text-[11px] px-1.5 h-[22px] rounded border border-border text-muted-foreground hover:bg-muted/60 transition-colors"
          >
            reset layout
          </button>
        </>
      )}
    </header>
  )
}
