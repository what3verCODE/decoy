import { useUnit } from 'effector-react'
import type { JSX } from 'preact'
import type { VariantAddress } from '../api'
import { collectionModel, collectionsModel, selectionModel } from '../model'

/** Whether `address` is currently pinned as an override (same route:preset:variant). */
function isPinned(pinned: VariantAddress[], address: VariantAddress): boolean {
  return pinned.some(
    (o) =>
      o.route === address.route && o.preset === address.preset && o.variant === address.variant,
  )
}

export function CollectionsPanel(): JSX.Element {
  return (
    <section class="h-full flex flex-col overflow-hidden" data-testid="collections-panel">
      <div class="tile-drag-handle flex items-center gap-2 h-9 px-4 border-b border-border shrink-0">
        <h2 class="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Collections
        </h2>
        <Overrides />
      </div>
      <div class="overflow-y-auto flex-1">
        <Collections />
        <ActiveEntries />
      </div>
    </section>
  )
}

function Overrides() {
  const [overrides, handleReset] = useUnit([selectionModel.$overrides, collectionsModel.reset])

  const overridesLength = overrides?.length ?? 0

  if (overridesLength === 0) {
    return null
  }

  return (
    <>
      <span
        data-testid="override-count"
        class="text-[11px] text-amber tabular-nums"
      >{`${overridesLength} pinned`}</span>
      <div class="flex-1" />
      <button
        type="button"
        onClick={handleReset}
        data-testid="overrides-reset"
        class="text-[11px] px-1.5 h-[18px] rounded border border-border text-muted-foreground hover:bg-muted/60 transition-colors"
      >
        reset
      </button>
    </>
  )
}

function Collections() {
  const [collections, pending, error, active, handleSwitchTo] = useUnit([
    collectionsModel.$collections,
    collectionsModel.$pending,
    collectionsModel.$error,
    selectionModel.$collection,
    collectionsModel.switchTo,
  ])

  if (pending) {
    return <p class="px-4 py-6 text-muted-foreground text-[12px]">loading collections…</p>
  }

  if (error !== null) {
    return (
      <p class="px-4 py-6 text-rose text-[12px]" data-testid="collections-error">
        {error}
      </p>
    )
  }

  if (collections.length === 0) {
    return <p class="px-4 py-6 text-muted-foreground text-[12px]">no collections defined</p>
  }

  return (
    <ul>
      {collections.map((collection) => {
        const isActive = collection.name === active
        return (
          <li key={collection.name}>
            <button
              type="button"
              data-testid="collection-row"
              data-active={isActive ? 'true' : 'false'}
              onClick={() => handleSwitchTo(collection.name)}
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
  )
}

function ActiveEntries() {
  const [collections, activeEntries, overrides, handlePinEntry] = useUnit([
    collectionsModel.$collections,
    collectionModel.$entries,
    selectionModel.$overrides,
    collectionsModel.pinEntry,
  ])

  const hasCollections = collections.length > 0
  const hasEntires = activeEntries.length > 0

  if (!hasCollections || !hasEntires) {
    return null
  }

  return (
    <div data-testid="active-entries" class="border-t border-border mt-1">
      <div class="flex items-center h-7 px-4">
        <h3 class="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Active Entries
        </h3>
      </div>
      <ul>
        {activeEntries.map((entry) => {
          const pinnedHere = isPinned(overrides, entry)
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
                onClick={() => handlePinEntry(entry)}
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
  )
}
