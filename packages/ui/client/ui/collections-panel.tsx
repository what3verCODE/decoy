import type { JSX } from 'preact'
import type { VariantAddress } from '../api'
import {
  activeCollection,
  activeEntries,
  collectionsLoad,
  overrideCount,
  overrides,
  pinEntry,
  resetOverrides,
  switchCollection,
} from '../model/collections'

/** Whether `address` is currently pinned as an override (same route:preset:variant). */
function isPinned(pinned: VariantAddress[], address: VariantAddress): boolean {
  return pinned.some(
    (o) =>
      o.route === address.route && o.preset === address.preset && o.variant === address.variant,
  )
}

export function CollectionsPanel(): JSX.Element {
  const current = collectionsLoad.value
  const active = activeCollection.value
  const pinned = overrides.value
  return (
    <section
      class="w-64 shrink-0 flex flex-col overflow-hidden border-r border-border"
      data-testid="collections-panel"
    >
      <div class="flex items-center gap-2 h-9 px-4 border-b border-border shrink-0">
        <h2 class="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Collections
        </h2>
        {overrideCount.value > 0 && (
          <>
            <span
              data-testid="override-count"
              class="text-[11px] text-amber tabular-nums"
            >{`${overrideCount.value} pinned`}</span>
            <div class="flex-1" />
            <button
              type="button"
              onClick={() => void resetOverrides()}
              data-testid="overrides-reset"
              class="text-[11px] px-1.5 h-[18px] rounded border border-border text-muted-foreground hover:bg-muted/60 transition-colors"
            >
              reset
            </button>
          </>
        )}
      </div>
      <div class="overflow-y-auto flex-1">
        {current.state === 'loading' && (
          <p class="px-4 py-6 text-muted-foreground text-[12px]">loading collections…</p>
        )}
        {current.state === 'error' && (
          <p class="px-4 py-6 text-rose text-[12px]" data-testid="collections-error">
            {current.message}
          </p>
        )}
        {current.state === 'ready' && current.collections.length === 0 && (
          <p class="px-4 py-6 text-muted-foreground text-[12px]">no collections defined</p>
        )}
        {current.state === 'ready' && current.collections.length > 0 && (
          <ul>
            {current.collections.map((collection) => {
              const isActive = collection.name === active
              return (
                <li key={collection.name}>
                  <button
                    type="button"
                    data-testid="collection-row"
                    data-active={isActive ? 'true' : 'false'}
                    onClick={() => void switchCollection(collection.name)}
                    class={`w-full flex items-center gap-2 px-4 py-1.5 text-left border-l-2 transition-colors ${
                      isActive
                        ? 'border-emerald bg-muted/60 text-foreground'
                        : 'border-transparent text-muted-foreground hover:bg-muted/40'
                    }`}
                  >
                    <span class="font-mono text-[12px] truncate flex-1">{collection.name}</span>
                    {isActive && (
                      <span class="text-[10px] uppercase tracking-wider text-emerald">active</span>
                    )}
                    <span class="font-mono text-[11px] text-muted-foreground tabular-nums">
                      {collection.entryCount}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        {current.state === 'ready' && activeEntries.value.length > 0 && (
          <div data-testid="active-entries" class="border-t border-border mt-1">
            <div class="flex items-center h-7 px-4">
              <h3 class="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Active Entries
              </h3>
            </div>
            <ul>
              {activeEntries.value.map((entry) => {
                const pinnedHere = isPinned(pinned, entry)
                return (
                  <li
                    key={`${entry.route}:${entry.preset}:${entry.variant}`}
                    data-testid="entry-row"
                    class="flex items-center gap-2 px-4 py-1 hover:bg-muted/40 transition-colors"
                  >
                    <span class="font-mono text-[11px] text-foreground truncate flex-1">
                      {`${entry.route}:${entry.preset}:${entry.variant}`}
                    </span>
                    <button
                      type="button"
                      data-testid="entry-pin"
                      data-pinned={pinnedHere ? 'true' : 'false'}
                      onClick={() => void pinEntry(entry)}
                      class={`text-[10px] px-1.5 h-[18px] rounded border transition-colors ${
                        pinnedHere
                          ? 'border-amber/30 bg-amber/10 text-amber'
                          : 'border-border text-muted-foreground hover:bg-muted/60'
                      }`}
                    >
                      {pinnedHere ? 'pinned' : 'pin'}
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </div>
    </section>
  )
}
