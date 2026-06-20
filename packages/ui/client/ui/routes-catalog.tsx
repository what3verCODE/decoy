import { useUnit } from 'effector-react'
import type { JSX } from 'preact'
import { routeModel, routesModel } from '../model'
import { MethodBadge } from './badges'

export function RoutesCatalog(): JSX.Element {
  const [routes, pending, error, openRoute] = useUnit([
    routesModel.$routes,
    routesModel.$pending,
    routesModel.$error,
    routeModel.load,
  ])
  return (
    <section class="flex-1 min-w-0 flex flex-col overflow-hidden" data-testid="routes-catalog">
      <div class="flex items-center h-9 px-4 border-b border-border shrink-0">
        <h2 class="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Routes Catalog
        </h2>
      </div>
      <div class="overflow-y-auto flex-1">
        {pending && <p class="px-4 py-6 text-muted-foreground text-[12px]">loading routes…</p>}
        {error !== null && (
          <p class="px-4 py-6 text-rose text-[12px]" data-testid="routes-error">
            {error}
          </p>
        )}
        {!pending && error === null && routes.length === 0 && (
          <p class="px-4 py-6 text-muted-foreground text-[12px]">no routes defined</p>
        )}
        {routes.length > 0 && (
          <table class="w-full border-collapse">
            <thead class="sticky top-0 bg-card z-10">
              <tr class="text-[10px] uppercase tracking-wider text-muted-foreground text-left">
                <th class="font-medium px-4 py-1.5 w-16">method</th>
                <th class="font-medium px-2 py-1.5">path</th>
                <th class="font-medium px-2 py-1.5">id</th>
                <th class="font-medium px-2 py-1.5 w-20 text-right">presets</th>
                <th class="font-medium px-4 py-1.5 w-20 text-right">variants</th>
              </tr>
            </thead>
            <tbody>
              {routes.map((route) => (
                <tr
                  key={route.id}
                  data-testid="route-row"
                  class="border-b border-border/60 hover:bg-muted/60 transition-colors"
                >
                  <td class="px-4 py-1.5">
                    <MethodBadge method={route.method} />
                  </td>
                  <td class="px-2 py-1.5 font-mono text-[12px] text-foreground">{route.path}</td>
                  <td class="px-2 py-1.5">
                    <button
                      type="button"
                      data-testid="route-open"
                      onClick={() => void openRoute(route.id)}
                      class="font-mono text-[12px] text-muted-foreground hover:text-foreground hover:underline"
                    >
                      {route.id}
                    </button>
                  </td>
                  <td class="px-2 py-1.5 font-mono text-[12px] text-foreground text-right tabular-nums">
                    {route.presetCount}
                  </td>
                  <td class="px-4 py-1.5 font-mono text-[12px] text-foreground text-right tabular-nums">
                    {route.variantCount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  )
}
