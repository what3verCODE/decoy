import { attach, createEvent, createStore, sample } from 'effector'
import { reset } from 'patronum'
import { type RouteDetail, type TryResult, tryRequest } from '../api'
import type { RouteModel } from './create-route-model'
import type { ServicesModel } from './create-services-model'

type PlaygroundModelDeps = {
  servicesModel: Pick<ServicesModel, '$active'>
  routeModel: Pick<RouteModel, '$route'>
}

type DryrunArgs = {
  service: string | null
  route: RouteDetail | null
}

export function createPlaygroundModel({ servicesModel, routeModel }: PlaygroundModelDeps) {
  const $result = createStore<TryResult | null>(null)
  const $error = createStore<string | null>(null)

  const dryrun = createEvent<string>()

  const dryrunFx = attach({
    source: {
      service: servicesModel.$active,
      route: routeModel.$route,
    },
    effect: ({ service, route }: DryrunArgs, body: string) => {
      if (!route?.method) {
        throw new Error('unable to dryrun without route method')
      }

      if (!route?.path) {
        throw new Error('unable to dryrun without route path')
      }

      return tryRequest(
        {
          method: route.method,
          path: route.path,
          body: parse(body),
        },
        service,
      )
    },
  })

  sample({
    clock: dryrun,
    target: dryrunFx,
  })

  sample({
    clock: dryrunFx.doneData,
    target: $result,
  })

  sample({
    clock: dryrunFx.failData,
    fn: messageOf,
    target: $error,
  })

  reset({ clock: dryrunFx, target: [$result, $error] })

  return {
    $result,
    $error,
    $pending: dryrunFx.pending,

    dryrun,
  }
}

function parse(text: string): unknown {
  const trimmed = text.trim()
  if (!trimmed) {
    return undefined
  }
  try {
    return JSON.parse(trimmed)
  } catch {
    return trimmed
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
