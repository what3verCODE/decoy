import { attach, createEvent, createStore, sample } from 'effector'
import { reset } from 'patronum'
import { fetchRouteDetail, type RouteDetail } from '../api'
import type { ServicesModel } from './create-services-model'

type RouteModelDeps = {
  servicesModel: Pick<ServicesModel, '$active'>
}

export function createRouteModel({ servicesModel }: RouteModelDeps) {
  const $route = createStore<RouteDetail | null>(null)
  const $error = createStore<string | null>(null)

  const load = createEvent<string>()
  const close = createEvent()

  const loadRouteFx = attach({
    source: servicesModel.$active,
    effect: (service: string | null, route: string) => fetchRouteDetail(route, service),
  })

  sample({
    clock: load,
    target: loadRouteFx,
  })

  sample({
    clock: loadRouteFx.doneData,
    target: $route,
  })

  sample({
    clock: loadRouteFx.failData,
    fn: messageOf,
    target: $error,
  })

  reset({ clock: [loadRouteFx, close], target: [$route, $error] })

  return {
    $route,
    $error,
    $pending: loadRouteFx.pending,

    load,
    close,
  }
}

export type RouteModel = ReturnType<typeof createRouteModel>

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
