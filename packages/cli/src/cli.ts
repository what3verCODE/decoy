import { parseArgs } from 'node:util'
import { formatIssues, hasErrors, loadConfig, validateConfig } from '@decoy/config'
import { createLogger, createServer, type DecoyServer, type Logger } from '@decoy/server'

export interface RunOptions {
  logger?: Logger
  /** Sink for CLI output (help text, the `check` report). Defaults to `console.log`. */
  out?: (message: string) => void
}

const HELP = `decoy — a fast, contract-first HTTP mock you point a base URL at.

Usage:
  decoy start [--config <path>] [--port <port>] [--json]
  decoy check [--config <path>]
  decoy help

Commands:
  start   Boot a Decoy server from a decoy.config.* (or the default mocks/ source).
  check   Validate the config + mocks and exit non-zero on any error (CI gate).
  help    Show this help.

Options:
  --config <path>   Path to a decoy.config.{ts,js,mjs,json,yaml} file.
  --port <port>     Override the configured port (start only).
  --json            Emit machine-readable JSON log lines for CI (start only).`

/**
 * Run the CLI. `start` resolves with the running server (so tests can drive and
 * close it); other commands resolve with `undefined`.
 */
export async function run(
  argv: string[],
  options: RunOptions = {},
): Promise<DecoyServer | undefined> {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      config: { type: 'string' },
      port: { type: 'string' },
      json: { type: 'boolean' },
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

  const service = await loadConfig({ configPath: values.config })
  if (values.port !== undefined) {
    const port = Number(values.port)
    if (!Number.isInteger(port) || port < 0) {
      throw new Error(`invalid --port: ${values.port}`)
    }
    service.port = port
  }

  const logger = options.logger ?? createLogger({ json: Boolean(values.json) })
  const server = createServer(service, { logger })
  await server.listen()
  return server
}
