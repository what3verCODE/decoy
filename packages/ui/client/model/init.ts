import { loadCollections } from './collections'
import { startLogStream } from './logs'
import { loadRoutes } from './routes'
import { loadServices } from './services'
import { loadSessions } from './sessions'

/**
 * Kick off all data flow on mount — the single boot intent the entry fires.
 * Owning the "what happens on boot" wiring here keeps `main.tsx` from reaching
 * into individual model functions; adding a data source is a one-line change.
 * Returns a teardown that closes any open streams.
 *
 * Services load first so the active `?service=` selector is seeded before the
 * per-instance catalog/collections/sessions fetch (the first service is the
 * aggregator's default target, so an un-awaited race would still hit it). The
 * live log stream is aggregated across services, so it opens independently.
 */
export function startApp(): () => void {
  const stream = startLogStream()
  void loadServices().then(() => {
    void loadRoutes()
    void loadCollections()
    void loadSessions()
  })
  return () => stream.close()
}
