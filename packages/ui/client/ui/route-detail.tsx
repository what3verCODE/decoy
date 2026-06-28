import { useUnit } from 'effector-react'
import type { JSX } from 'preact'
import type { RoutePreset, RouteVariant } from '../api'
import { routeModel } from '../model'
import { MethodBadge, StatusBadge } from './badges'

/** Render a value as pretty JSON for the presets/variants/response readouts. */
function json(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function PresetRow({ name, preset }: { name: string; preset: RoutePreset }): JSX.Element {
  const isCatchAll = Object.keys(preset).length === 0
  return (
    <li data-testid="preset-row" class="px-4 py-1.5 border-b border-border/60">
      <div class="flex items-center gap-2">
        <span class="font-mono text-[12px] text-foreground">{name}</span>
        {isCatchAll && (
          <span class="text-[10px] uppercase tracking-wider text-muted-foreground">catch-all</span>
        )}
      </div>
      {!isCatchAll && (
        <pre class="mt-1 font-mono text-[11px] text-muted-foreground whitespace-pre-wrap break-words">
          {json(preset)}
        </pre>
      )}
    </li>
  )
}

function VariantRow({ name, variant }: { name: string; variant: RouteVariant }): JSX.Element {
  return (
    <li data-testid="variant-row" class="px-4 py-1.5 border-b border-border/60">
      <div class="flex items-center gap-2">
        <span class="font-mono text-[12px] text-foreground">{name}</span>
        <StatusBadge status={variant.status ?? 200} />
      </div>
      {variant.body !== undefined && (
        <pre class="mt-1 font-mono text-[11px] text-muted-foreground whitespace-pre-wrap break-words">
          {json(variant.body)}
        </pre>
      )}
    </li>
  )
}

/**
 * Always-mounted tile that reacts to the currently selected route (`routeModel.$route`),
 * driven by opening a row in the Routes tile. With nothing selected it shows a placeholder
 * — there is no longer a catalog/detail switch; both are persistent tiles side by side.
 */
export function RouteDetail(): JSX.Element {
  const [route, pending, error, close] = useUnit([
    routeModel.$route,
    routeModel.$pending,
    routeModel.$error,
    routeModel.close,
  ])
  return (
    <section class="h-full flex flex-col overflow-hidden" data-testid="route-detail">
      <div class="tile-drag-handle flex items-center gap-2 h-9 px-4 border-b border-border shrink-0">
        <h2 class="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Route Detail
        </h2>
        {route && (
          <>
            <MethodBadge method={route.method} />
            <span class="font-mono text-[12px] text-foreground">{route.path}</span>
            <span class="font-mono text-[12px] text-muted-foreground">{route.id}</span>
            <div class="flex-1" />
            <button
              type="button"
              data-testid="route-detail-back"
              onClick={() => close()}
              class="text-[11px] px-1.5 h-[18px] rounded border border-border text-muted-foreground hover:bg-muted/60 transition-colors"
            >
              clear
            </button>
          </>
        )}
      </div>
      <div class="overflow-y-auto flex-1">
        {pending && <p class="px-4 py-6 text-muted-foreground text-[12px]">loading route…</p>}
        {error !== null && (
          <p class="px-4 py-6 text-rose text-[12px]" data-testid="route-detail-error">
            {error}
          </p>
        )}
        {!route && !pending && error === null && (
          <p class="px-4 py-6 text-muted-foreground text-[12px]" data-testid="route-detail-empty">
            select a route to inspect it
          </p>
        )}
        {route && (
          <>
            <div class="flex items-center h-7 px-4">
              <h3 class="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Presets
              </h3>
            </div>
            <ul>
              {Object.entries(route.presets).map(([name, preset]) => (
                <PresetRow key={name} name={name} preset={preset} />
              ))}
            </ul>
            <div class="flex items-center h-7 px-4 mt-1">
              <h3 class="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Variants
              </h3>
            </div>
            <ul>
              {Object.entries(route.variants).map(([name, variant]) => (
                <VariantRow key={name} name={name} variant={variant} />
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  )
}
