import { attach, createEvent, createStore, sample } from 'effector'
import { reset } from 'patronum'
import { fetchSelection, type Selection } from '../api'
import type { ServicesModel } from './create-services-model'

type SelectionModelDeps = {
  servicesModel: Pick<ServicesModel, '$active'>
}

export function createSelectionModel({ servicesModel }: SelectionModelDeps) {
  const $selection = createStore<Selection | null>(null)

  const $collection = $selection.map((selection) => selection?.collection ?? null)
  const $overrides = $selection.map((selection) => selection?.overrides ?? [])

  const $error = createStore<string | null>(null)

  const load = createEvent()
  // Ingest a fresh Selection returned by a control mutation (switch/pin/reset),
  // so overrides + the active-collection marker update without a refetch.
  const put = createEvent<Selection>()

  const loadSelectionFx = attach({
    source: servicesModel.$active,
    effect: (service: string | null) => fetchSelection(service),
  })

  sample({
    clock: load,
    target: loadSelectionFx,
  })

  sample({
    clock: [loadSelectionFx.doneData, put],
    target: $selection,
  })

  sample({
    clock: loadSelectionFx.failData,
    fn: messageOf,
    target: $error,
  })

  reset({ clock: loadSelectionFx, target: $error })

  return {
    $selection,
    $collection,
    $overrides,
    $error,

    load,
    put,
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
