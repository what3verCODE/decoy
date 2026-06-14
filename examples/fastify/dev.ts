// `dev` entrypoint: load the example's config, register the Decoy plugin in a real
// Fastify app, and listen on the config's fixed port for a human to curl. Run from
// source through jiti, so `pnpm dev` needs no prior build — fastify has no decorators
// and we own this entrypoint, so jiti transpiles the @decoy/* TS-source imports and
// loads fastify from node_modules with no bundle step (unlike examples/nest).
import { loadConfig } from '@decoy/config'
import { buildApp } from './app'

async function main(): Promise<void> {
  const service = await loadConfig({ configPath: './decoy.config.ts' })
  const { app } = await buildApp(service)
  const { port } = service

  await app.listen({ port })
  console.log(`decoy example (fastify) listening on http://localhost:${port}`)
  console.log(`  curl http://localhost:${port}/users/42   # mocked variant (happy-path)`)
  console.log(`  curl http://localhost:${port}/health     # real host route (fall-through)`)
  console.log(`  curl http://localhost:${port}/orders     # fails closed (501 + x-mock-miss)`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
