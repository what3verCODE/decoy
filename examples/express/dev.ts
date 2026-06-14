// `dev` entrypoint: load the example's config, mount the Decoy middleware in a real
// Express app, and listen on the config's fixed port for a human to curl. Run from
// source through jiti, so `pnpm dev` needs no prior build.
import { loadConfig } from '@decoy/config'
import { buildApp } from './app'

async function main(): Promise<void> {
  const service = await loadConfig({ configPath: './decoy.config.ts' })
  const { app } = buildApp(service)
  const { port } = service

  app.listen(port, () => {
    console.log(`decoy example (express) listening on http://localhost:${port}`)
    console.log(`  curl http://localhost:${port}/users/42   # mocked variant (happy-path)`)
    console.log(`  curl http://localhost:${port}/health     # real host handler (fall-through)`)
  })
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
