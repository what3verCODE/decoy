import { useUnit } from 'effector-react'
import type { JSX } from 'preact'
import { collectionsModel, selectionModel } from '../model'

export function CollectionsPanel(): JSX.Element {
  return (
    <section class="h-full flex flex-col overflow-hidden" data-testid="collections-panel">
      <div class="tile-drag-handle flex items-center gap-2 h-9 px-4 border-b border-border shrink-0">
        <h2 class="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Collections
        </h2>
      </div>
      <div class="overflow-y-auto flex-1">
        <Collections />
      </div>
    </section>
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
