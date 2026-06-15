import { computed, signal } from '@preact/signals'
import {
  type CollectionCatalogEntry,
  fetchCollectionDetail,
  fetchCollections,
  fetchSelection,
  pinRoute,
  resetOverrides as resetOverridesApi,
  setCollection,
  type VariantAddress,
} from '../api'

export type CollectionsLoad =
  | { state: 'loading' }
  | { state: 'ready'; collections: CollectionCatalogEntry[] }
  | { state: 'error'; message: string }

/** The collections catalog (names + entry counts) for the scenario list. */
export const collectionsLoad = signal<CollectionsLoad>({ state: 'loading' })
/** The active collection — the single source of truth for the active marker. */
export const activeCollection = signal<string>('')
/** The active collection's resolved entries — the pinnable `route:preset:variant` rows. */
export const activeEntries = signal<VariantAddress[]>([])
/** Per-route overrides; their count is surfaced and reset clears them. */
export const overrides = signal<VariantAddress[]>([])
export const overrideCount = computed(() => overrides.value.length)

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function loadActiveEntries(name: string): Promise<void> {
  if (!name) {
    activeEntries.value = []
    return
  }
  try {
    activeEntries.value = (await fetchCollectionDetail(name)).entries
  } catch {
    activeEntries.value = []
  }
}

/**
 * Load the collections catalog and seed the active collection + overrides from
 * the current selection — called once on boot. The selection is authoritative
 * for the active marker and override count; the catalog supplies the list.
 */
export async function loadCollections(): Promise<void> {
  collectionsLoad.value = { state: 'loading' }
  try {
    const [collections, selection] = await Promise.all([fetchCollections(), fetchSelection()])
    collectionsLoad.value = { state: 'ready', collections }
    activeCollection.value = selection.collection
    overrides.value = selection.overrides ?? []
    await loadActiveEntries(selection.collection)
  } catch (error) {
    collectionsLoad.value = { state: 'error', message: messageOf(error) }
  }
}

/** Switch the active collection; the next mocked request resolves against it. */
export async function switchCollection(name: string): Promise<void> {
  const selection = await setCollection(name)
  activeCollection.value = selection.collection
  overrides.value = selection.overrides ?? []
  await loadActiveEntries(selection.collection)
}

/** Pin one entry as a per-route override; it survives a collection switch. */
export async function pinEntry(address: VariantAddress): Promise<void> {
  const selection = await pinRoute(address.route, address.preset, address.variant)
  overrides.value = selection.overrides ?? []
}

/** Drop all per-route overrides, returning to the active collection's baseline. */
export async function resetOverrides(): Promise<void> {
  const selection = await resetOverridesApi()
  overrides.value = selection.overrides ?? []
}
