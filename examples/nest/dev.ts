// `dev` entrypoint: load the example's config, wire the Decoy module into a real
// NestJS app, and listen on the config's fixed port for a human to curl. Bundled to
// a runnable `dist/main.cjs` by Rspack (see rspack.config.mjs), so `pnpm dev` needs
// no global TypeScript runner.
import { loadConfig } from '@decoy/config'
import { buildApp } from './app'

async function main(): Promise<void> {
  const service = await loadConfig({ configPath: './decoy.config.ts' })
  const { app } = await buildApp(service)
  const { port } = service

  await app.listen(port)
  console.log(`decoy example (nest) listening on http://localhost:${port}`)
  console.log(`  curl http://localhost:${port}/users/42   # mocked variant (happy-path)`)
  console.log(`  curl http://localhost:${port}/health     # real host controller (fall-through)`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
