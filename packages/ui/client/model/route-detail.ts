import { signal } from '@preact/signals'
import { fetchRouteDetail, type RouteDetail, type TryResult, tryRequest } from '../api'

export type DetailLoad =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'ready'; route: RouteDetail }
  | { state: 'error'; message: string }

/** The route the user has drilled into; `null` shows the catalog. The keystone of the detail view. */
export const selectedRouteId = signal<string | null>(null)
/** The selected route's full detail (presets + variants). */
export const detail = signal<DetailLoad>({ state: 'idle' })

export type TryLoad =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'ready'; result: TryResult }
  | { state: 'error'; message: string }

/** The playground form, pre-filled from the route on open. */
export const tryMethod = signal<string>('GET')
export const tryPath = signal<string>('')
export const tryBody = signal<string>('')
/** The last dry-run outcome rendered under the playground. */
export const tryLoad = signal<TryLoad>({ state: 'idle' })

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Parse the playground body textarea: empty → no body; JSON when it parses, else raw text. */
function parseBody(text: string): unknown {
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

/** Drill into a route: load its detail and pre-fill the playground from its method/path. */
export async function openRoute(id: string): Promise<void> {
  selectedRouteId.value = id
  detail.value = { state: 'loading' }
  tryLoad.value = { state: 'idle' }
  try {
    const route = await fetchRouteDetail(id)
    detail.value = { state: 'ready', route }
    tryMethod.value = route.method
    tryPath.value = route.path
    tryBody.value = ''
  } catch (error) {
    detail.value = { state: 'error', message: messageOf(error) }
  }
}

/** Return to the routes catalog, clearing the detail and playground state. */
export function closeRoute(): void {
  selectedRouteId.value = null
  detail.value = { state: 'idle' }
  tryLoad.value = { state: 'idle' }
}

/** Fire the playground request against the current selection via `POST /admin/try`. */
export async function runTry(): Promise<void> {
  tryLoad.value = { state: 'loading' }
  try {
    const result = await tryRequest({
      method: tryMethod.value,
      path: tryPath.value,
      body: parseBody(tryBody.value),
    })
    tryLoad.value = { state: 'ready', result }
  } catch (error) {
    tryLoad.value = { state: 'error', message: messageOf(error) }
  }
}
