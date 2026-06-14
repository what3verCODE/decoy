import { parseArgs } from 'node:util'
import { loadConfig } from '@decoy/config'
import { createServer, type DecoyServer, type Logger } from '@decoy/server'

export interface RunOptions {
  logger?: Logger
}

const HELP = `decoy — a fast, contract-first HTTP mock you point a base URL at.

Usage:
  decoy start [--config <path>] [--port <port>]
  decoy help

Commands:
  start   Boot a Decoy server from a decoy.config.* (or the default mocks/ source).
  help    Show this help.

Options:
  --config <path>   Path to a decoy.config.{ts,js,mjs,json,yaml} file.
  --port <port>     Override the configured port.`

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
      help: { type: 'boolean', short: 'h' },
    },
  })

  const command = positionals[0]

  if (values.help || command === undefined || command === 'help') {
    console.log(HELP)
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

  const server = createServer(service, { logger: options.logger })
  await server.listen()
  return server
}
