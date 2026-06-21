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

/**
 * The active collection's resolved entries — the pinnable rows that follow the
 * selection. Split out of the Collections panel into its own always-mounted tile so
 * the user can place "what the active collection resolves to" wherever they work.
 */
export function CurrentRoutesPanel(): JSX.Element {
  return (
    <section class="h-full flex flex-col overflow-hidden" data-testid="current-routes-panel">
      <div class="tile-drag-handle flex items-center gap-2 h-9 px-4 border-b border-border shrink-0">
        <h2 class="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Current Routes
        </h2>
        <Overrides />
      </div>
      <div class="overflow-y-auto flex-1">
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

function ActiveEntries() {
  const [collections, activeEntries, overrides, handlePinEntry] = useUnit([
    collectionsModel.$collections,
    collectionModel.$entries,
    selectionModel.$overrides,
    collectionsModel.pinEntry,
  ])

  const hasCollections = collections.length > 0
  const hasEntries = activeEntries.length > 0

  if (!hasCollections || !hasEntries) {
    return <p class="px-4 py-6 text-muted-foreground text-[12px]">no active entries</p>
  }

  return (
    <div data-testid="active-entries">
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
