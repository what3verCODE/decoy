import { attach, createEffect, createEvent, createStore, sample } from 'effector'
import { reset } from 'patronum'
import { fetchSessionLogs, fetchSessions, type RequestLogRecord, type SessionInfo } from '../api'
import type { ServicesModel } from './create-services-model'

type SessionsModelDeps = {
  servicesModel: Pick<ServicesModel, '$active'>
}

export function createSessionsModel({ servicesModel }: SessionsModelDeps) {
  const $sessions = createStore<SessionInfo[]>([])
  const $sessionsError = createStore<string | null>(null)

  const $selectedSession = createStore<string | null>(null)
  const $timeline = createStore<RequestLogRecord[]>([])
  const $timelineError = createStore<string | null>(null)

  const load = createEvent()
  const open = createEvent<string>()
  const close = createEvent()

  const loadSessionsFx = attach({
    source: servicesModel.$active,
    effect: (service: string | null) => fetchSessions(service),
  })
  const openSessionFx = createEffect(fetchSessionLogs)

  sample({
    clock: load,
    target: [loadSessionsFx, close],
  })

  sample({
    clock: loadSessionsFx.doneData,
    target: $sessions,
  })

  sample({
    clock: loadSessionsFx.failData,
    fn: messageOf,
    target: $sessionsError,
  })

  reset({ clock: loadSessionsFx, target: $sessionsError })

  sample({
    clock: open,
    target: [$selectedSession, openSessionFx],
  })

  sample({
    clock: openSessionFx.doneData,
    target: $timeline,
  })

  sample({
    clock: openSessionFx.failData,
    fn: messageOf,
    target: $timelineError,
  })

  reset({ clock: openSessionFx, target: $timelineError })

  reset({ clock: close, target: [$selectedSession, $timeline] })

  return {
    $sessions,
    $sessionsError,
    $sessionsPending: loadSessionsFx.pending,
    $selectedSession,
    $timeline,
    $timelineError,
    $timelinePending: openSessionFx.pending,

    load,
    open,
    close,
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
