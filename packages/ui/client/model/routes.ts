import { computed, signal } from '@preact/signals'
import { fetchRoutes, type RouteCatalogEntry } from '../api'

export type Load =
  | { state: 'loading' }
  | { state: 'ready'; routes: RouteCatalogEntry[] }
  | { state: 'error'; message: string }

export const load = signal<Load>({ state: 'loading' })
export const routeCount = computed(() =>
  load.value.state === 'ready' ? load.value.routes.length : 0,
)

/** Fetch the routes catalog into the `load` signal — called once on boot. */
export async function loadRoutes(): Promise<void> {
  load.value = { state: 'loading' }
  try {
    load.value = { state: 'ready', routes: await fetchRoutes() }
  } catch (error) {
    load.value = { state: 'error', message: error instanceof Error ? error.message : String(error) }
  }
}
