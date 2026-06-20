import { attach, createEvent, createStore, merge, sample } from 'effector'
import {
  type CollectionCatalogEntry,
  fetchCollections,
  pinRoute,
  resetOverrides,
  useCollection,
  type VariantAddress,
} from '../api'
import type { ServicesModel } from './create-services-model'

type CollectionModelDeps = {
  servicesModel: Pick<ServicesModel, '$active'>
}

export function createCollectionsModel({ servicesModel }: CollectionModelDeps) {
  const $collections = createStore<CollectionCatalogEntry[]>([])
  const $error = createStore<string | null>(null)

  const load = createEvent()
  const reset = createEvent()
  const switchTo = createEvent<string>()
  const pinEntry = createEvent<VariantAddress>()

  const loadCollectionsFx = attach({
    source: servicesModel.$active,
    effect: (service: string | null) => fetchCollections(service),
  })

  const resetOverridesFx = attach({
    source: servicesModel.$active,
    effect: (service: string | null) => resetOverrides(service),
  })
  const swtichToCollectionFx = attach({
    source: servicesModel.$active,
    effect: (service: string | null, collection: string) => useCollection(collection, service),
  })

  const pinEntryFx = attach({
    source: servicesModel.$active,
    effect: (service: string | null, address: VariantAddress) =>
      pinRoute(address.route, address.preset, address.variant, service),
  })

  sample({
    clock: load,
    target: loadCollectionsFx,
  })

  sample({
    clock: loadCollectionsFx.doneData,
    target: $collections,
  })

  sample({
    clock: reset,
    target: resetOverridesFx,
  })

  sample({
    clock: loadCollectionsFx.failData,
    fn: messageOf,
    target: $error,
  })

  sample({
    clock: switchTo,
    target: swtichToCollectionFx,
  })

  sample({
    clock: pinEntry,
    target: pinEntryFx,
  })

  // Every control mutation echoes the new Selection; surfaced so the selection
  // model can refresh overrides + the active collection without a refetch.
  const selectionChanged = merge([
    swtichToCollectionFx.doneData,
    pinEntryFx.doneData,
    resetOverridesFx.doneData,
  ])

  return {
    $collections,
    $error,
    $pending: loadCollectionsFx.pending,

    load,
    reset,
    switchTo,
    pinEntry,
    selectionChanged,
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
