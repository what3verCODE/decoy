import { attach, createEvent, createStore, sample } from 'effector'
import { reset } from 'patronum'
import { type CollectionDetail, fetchCollectionDetail } from '../api'
import type { ServicesModel } from './create-services-model'

type CollectionModelDeps = {
  servicesModel: Pick<ServicesModel, '$active'>
}

export function createCollectionModel({ servicesModel }: CollectionModelDeps) {
  const $collection = createStore<CollectionDetail | null>(null)
  const $entries = $collection.map((collection) => collection?.entries ?? [])
  const $error = createStore<string | null>(null)

  const load = createEvent<string>()
  const close = createEvent()

  const loadCollectionFx = attach({
    source: servicesModel.$active,
    effect: (service: string | null, collection: string) =>
      fetchCollectionDetail(collection, service),
  })

  sample({
    clock: load,
    target: loadCollectionFx,
  })

  sample({
    clock: loadCollectionFx.doneData,
    target: $collection,
  })

  sample({
    clock: loadCollectionFx.failData,
    fn: messageOf,
    target: $error,
  })

  reset({ clock: [loadCollectionFx, close], target: [$collection, $error] })

  return {
    $collection,
    $entries,
    $error,
    $pending: loadCollectionFx.pending,

    load,
    close,
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
