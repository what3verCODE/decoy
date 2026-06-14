// `dev` entrypoint: boot the standalone server by calling the `decoy` CLI's own
// `run('start', …)` — the exact entrypoint the published `decoy` bin wraps. We run
// it from source through jiti (transpiling the workspace's TS), so `pnpm dev` needs
// no prior build; the port comes from decoy.config.ts.
import { run } from '@decoy/cli'

run(['start', '--config', './decoy.config.ts']).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
