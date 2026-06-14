import { parseArgs } from 'node:util'
import {
  formatIssues,
  hasErrors,
  loadConfig,
  loadConfigs,
  resolveAllWatchPaths,
  resolveWatchPaths,
  validateConfig,
} from '@decoy/config'
import {
  type CreateServerOptions,
  createLogger,
  createServer,
  type DecoyServer,
  type Logger,
} from '@decoy/server'

export interface RunOptions {
  logger?: Logger
  /** Sink for CLI output (help text, the `check` report). Defaults to `console.log`. */
  out?: (message: string) => void
}

const HELP = `decoy — a fast, contract-first HTTP mock you point a base URL at.

Usage:
  decoy start [--config <path>] [--port <port>] [--json] [--watch]
  decoy check [--config <path>]
  decoy help

Commands:
  start   Boot Decoy from a decoy.config.* (or the default mocks/ source). An
          array config (ADR-0006) boots one instance per entry, each on its
          own port — point each upstream's base URL at its instance.
  check   Validate the config + mocks and exit non-zero on any error (CI gate).
  help    Show this help.

Options:
  --config <path>   Path to a decoy.config.{ts,js,mjs,json,yaml} file.
  --port <port>     Override the configured port (start only; single-instance only).
  --json            Emit machine-readable JSON log lines for CI (start only).
  --watch           Dev-only hot reload: re-load on config/mocks changes (start only).
                    Works with an array config too — each instance watches its own
                    source. Off by default; never enable in CI/e2e.`

/**
 * Run the CLI. `start` resolves with the running server(s) so tests can drive and
 * close them — a single `DecoyServer` for a single-service config (unchanged), or
 * a `DecoyServer[]` for a multi-instance (array) config (ADR-0006). Other commands
 * resolve with `undefined`.
 */
export async function run(
  argv: string[],
  options: RunOptions = {},
): Promise<DecoyServer | DecoyServer[] | undefined> {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      config: { type: 'string' },
      port: { type: 'string' },
      json: { type: 'boolean' },
      watch: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  })

  const out = options.out ?? console.log
  const command = positionals[0]

  if (values.help || command === undefined || command === 'help') {
    out(HELP)
    return undefined
  }

  if (command === 'check') {
    const issues = await validateConfig({ configPath: values.config })
    if (issues.length > 0) {
      out(formatIssues(issues))
    }
    const errors = issues.filter((issue) => issue.severity === 'error').length
    const warnings = issues.length - errors
    if (hasErrors(issues)) {
      throw new Error(`validation failed: ${errors} error(s), ${warnings} warning(s)`)
    }
    out(warnings > 0 ? `config is valid (${warnings} warning(s))` : 'config is valid')
    return undefined
  }

  if (command !== 'start') {
    throw new Error(`unknown command: ${command}`)
  }

  // An array config boots N instances (ADR-0006); a single-object config boots one.
  const services = await loadConfigs({ configPath: values.config })
  const multi = services.length > 1

  if (values.port !== undefined) {
    if (multi) {
      throw new Error(
        'invalid --port: cannot override a multi-instance config — each service declares its own port',
      )
    }
    const port = Number(values.port)
    if (!Number.isInteger(port) || port < 0) {
      throw new Error(`invalid --port: ${values.port}`)
    }
    ;(services[0] as (typeof services)[number]).port = port
  }

  const logger = options.logger ?? createLogger({ json: Boolean(values.json) })

  // Dev-only hot reload (#44, #51): watch each instance's resolved source and
  // re-load just that instance on change (aggregate-validated). Off unless
  // --watch — frozen in CI/e2e. A single-instance config re-loads via loadConfig;
  // a multi-instance config (ADR-0006) watches each instance's own source and
  // re-loads it by index via loadConfigs — so editing one service's mocks re-loads
  // only that instance, while a shared-config edit re-validates the whole config
  // and re-loads every instance (invalid edit → each keeps current, warns).
  let watchFor: (index: number) => CreateServerOptions['watch'] = () => undefined
  if (values.watch) {
    if (multi) {
      const allPaths = await resolveAllWatchPaths({ configPath: values.config })
      watchFor = (index) => ({
        paths: allPaths[index] ?? [],
        reload: async () => {
          const reloaded = await loadConfigs({ configPath: values.config })
          const next = reloaded[index]
          if (next === undefined) {
            throw new Error(
              `instance #${index} no longer exists — restart to change the instance count`,
            )
          }
          return next
        },
      })
    } else {
      const watch = {
        paths: await resolveWatchPaths({ configPath: values.config }),
        reload: () => loadConfig({ configPath: values.config }),
      }
      watchFor = () => watch
    }
  }

  const servers = services.map((service, index) =>
    createServer(service, { logger, watch: watchFor(index) }),
  )
  await Promise.all(servers.map((server) => server.listen()))
  return servers.length === 1 ? (servers[0] as DecoyServer) : servers
}
