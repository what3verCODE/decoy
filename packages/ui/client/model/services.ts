import { signal } from '@preact/signals'
import { fetchServices, type ServiceInfo, setActiveService } from '../api'
import { loadCollections } from './collections'
import { loadRoutes } from './routes'
import { closeSession, loadSessions } from './sessions'

/**
 * The service axis (ADR-0017). `decoy start` with an array config boots one
 * instance per service, all aggregated behind one `--ui` server; the switcher
 * picks which instance the catalog/collection/override controls target. The logs
 * view stays aggregated across services (not switched). A single-instance config
 * is the degenerate one-service case.
 */
export const services = signal<ServiceInfo[]>([])
/** The service the controls currently target; `''` until the list is seeded. */
export const activeService = signal<string>('')

/**
 * Load the services list and target the first one — called once on boot, before
 * the catalog/collections load so their requests carry the right `?service=`. A
 * single service still seeds the switcher with one entry.
 */
export async function loadServices(): Promise<void> {
  let list: ServiceInfo[]
  try {
    list = await fetchServices()
  } catch {
    // An older server without /__decoy__/services: stay single-service (no selector,
    // and control calls carry no `?service=`, which the server defaults anyway).
    list = []
  }
  services.value = list
  const first = list[0]?.name ?? ''
  activeService.value = first
  setActiveService(first)
}

/**
 * Switch the controlled service: re-point the API selector and reload the
 * per-instance catalog + collections (its selection) for the new target. The
 * drilled-in session timeline is cleared (it belonged to the prior view). Does
 * nothing if the service is already active.
 */
export async function switchService(name: string): Promise<void> {
  if (name === activeService.value) {
    return
  }
  activeService.value = name
  setActiveService(name)
  // The catalog, collections (its selection), and session list are all per-instance.
  closeSession()
  await Promise.all([loadRoutes(), loadCollections(), loadSessions()])
}
