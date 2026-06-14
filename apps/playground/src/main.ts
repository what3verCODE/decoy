import { resolve } from 'node:path'
import { loadConfig } from '@decoy/config'
import { createServer } from '@decoy/server'
import { createApp } from './app'

/** Port the example app listens on; the Decoy upstream binds an ephemeral port. */
const APP_PORT = Number(process.env.PLAYGROUND_PORT ?? 3000)

/**
 * Boot the dogfood target: a Decoy instance (loaded from `decoy.config.ts`)
 * standing in for the upstream users API, and the example app pointed at it.
 * Run with `pnpm --filter @decoy/playground start`.
 */
async function main(): Promise<void> {
  const service = await loadConfig({
    configPath: resolve(process.cwd(), 'decoy.config.ts'),
  })

  const decoy = createServer(service)
  const decoyPort = await decoy.listen()
  const apiBaseUrl = `http://localhost:${decoyPort}`

  const app = createApp({ apiBaseUrl })
  const appPort = await app.listen(APP_PORT)

  console.log(
    `playground app on http://localhost:${appPort} → upstream faked by Decoy on ${apiBaseUrl}`,
  )
  console.log('try: curl http://localhost:%d/profile', appPort)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
