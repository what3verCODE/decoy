import { attach, createEvent, createStore, sample } from 'effector'
import { fetchRoutes, type RouteCatalogEntry } from '../api'
import type { ServicesModel } from './create-services-model'

type RoutesModelDeps = {
  servicesModel: Pick<ServicesModel, '$active'>
}

export function createRoutesModel({ servicesModel }: RoutesModelDeps) {
  const $routes = createStore<RouteCatalogEntry[]>([])
  const $error = createStore<string | null>(null)

  const load = createEvent()

  const loadRoutesFx = attach({
    source: servicesModel.$active,
    effect: (service: string | null) => fetchRoutes(service),
  })

  sample({
    clock: load,
    target: loadRoutesFx,
  })

  sample({
    clock: loadRoutesFx.doneData,
    target: $routes,
  })

  sample({
    clock: loadRoutesFx.failData,
    fn: messageOf,
    target: $error,
  })

  return {
    $routes,
    $error,
    $pending: loadRoutesFx.pending,

    load,
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
