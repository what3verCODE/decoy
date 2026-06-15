import { startLogStream } from './logs'
import { loadRoutes } from './routes'

/**
 * Kick off all data flow on mount — the single boot intent the entry fires.
 * Owning the "what happens on boot" wiring here keeps `main.tsx` from reaching
 * into individual model functions; adding a data source is a one-line change.
 * Returns a teardown that closes any open streams.
 */
export function startApp(): () => void {
  void loadRoutes()
  const stream = startLogStream()
  return () => stream.close()
}
