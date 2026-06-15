// `dev` entrypoint: boot the SPA + a live Decoy server on fixed ports for a human
// to poke. Open the SPA URL it prints; switch scenarios by curling the Decoy
// server's `/__decoy__` (the global session), e.g.
//   curl -X POST localhost:3004/__decoy__/collection -d '{"name":"error-state"}'
// Ctrl-C stops both. Runs from TS source via jiti — no build step.
import { createLogger } from '@decoy/server'
import { startStack } from './stack'
import { DECOY_PORT, SPA_PORT } from './tests/constants'

startStack({ decoyPort: DECOY_PORT, spaPort: SPA_PORT, logger: createLogger() })
  .then((stack) => {
    console.log(`SPA:   ${stack.spaUrl}`)
    console.log(`Decoy: ${stack.decoyBaseUrl}  (control: ${stack.decoyBaseUrl}/__decoy__)`)
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
