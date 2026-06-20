import { createEffect, createEvent, createStore, sample } from 'effector'
import { reset } from 'patronum'
import { fetchServices, type ServiceInfo } from '../api'

export function createServicesModel() {
  const $services = createStore<ServiceInfo[]>([])

  const $active = createStore<string | null>(null)

  const load = createEvent()
  const switchTo = createEvent<string>()

  const loadServicesFx = createEffect(fetchServices)

  sample({
    clock: load,
    target: loadServicesFx,
  })

  sample({
    clock: loadServicesFx.doneData,
    target: $services,
  })

  reset({ clock: loadServicesFx.fail, target: $services })

  const $firstService = sample({
    clock: $services,
    fn: (services) => services.at(0) ?? null,
  })

  sample({
    clock: $firstService,
    filter: Boolean,
    fn: (service) => service.name,
    target: $active,
  })

  sample({
    clock: switchTo,
    source: { active: $active, services: $services },
    filter: ({ active, services }, next) =>
      active !== next && services.some((service) => service.name === next),
    fn: (_, next) => next,
    target: $active,
  })

  return {
    $services,
    $active,

    load,
    switchTo,
  }
}

export type ServicesModel = ReturnType<typeof createServicesModel>
