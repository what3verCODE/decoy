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
  createRequestLogStore,
  createServer,
  createSharedRequestLogStore,
  createUiServer,
  type DecoyServer,
  type DecoyUiServer,
  version as decoyVersion,
  type Logger,
  type SharedRequestLogStore,
} from '@decoy/server'
import { createTui, type Tui } from './tui'

/** Default loopback port the `--ui` control panel binds (overridable with `--ui-port`). */
const DEFAULT_UI_PORT = 4100

export interface RunOptions {
  logger?: Logger
  /** Sink for CLI output (help text, the `check` report). Defaults to `console.log`. */
  out?: (message: string) => void
  /**
   * Injectable interactive TUI (`--tui`), for tests. Defaults to the real
   * stdin/stdout runtime ({@link createTui}). The TUI owns the display, so its
   * own logger renders live request lines — `logger` above is ignored in `--tui`.
   */
  tui?: Tui
  /**
   * Resolve the optional `@decoy/ui` package for `--ui` (its prebuilt-asset
   * directory). Defaults to a lazy `import('@decoy/ui')`; injected in tests. A
   * rejection means the package is not installed — `--ui` then fails closed.
   */
  resolveUi?: () => Promise<{ uiAssetDir: () => string; version: string }>
  /** Called with the running UI server when `--ui` starts one (for tests to drive/close). */
  onUiServer?: (server: DecoyUiServer) => void
}

const HELP = `decoy — a fast, contract-first HTTP mock you point a base URL at.

Usage:
  decoy start [--config <path>] [--port <port>] [--json] [--watch] [--tui]
              [--ui] [--ui-port <port>] [--ui-host <host>]
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
                    source. Off by default; never enable in CI/e2e.
  --tui             Launch an interactive TUI (Claude-Code-style slash commands:
                    /collection, /route, …) driving the in-process engine, with
                    live request logs (start only; single-instance only).
  --ui              Serve the @decoy/ui web control panel on its own loopback port
                    (start only). Needs the optional @decoy/ui package installed.
  --ui-port <port>  Port for the --ui panel (default ${DEFAULT_UI_PORT}).
  --ui-host <host>  Bind the --ui panel beyond loopback (prints an exposure warning).`

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
      tui: { type: 'boolean' },
      ui: { type: 'boolean' },
      'ui-port': { type: 'string' },
      'ui-host': { type: 'string' },
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

  // Interactive TUI (#48, DESIGN §12): drive the single in-process engine through
  // slash commands with live request logs. The TUI owns the display, so it serves
  // exactly one engine — a multi-instance config (ADR-0006) is rejected (boot the
  // group with plain `start`) — and --json (non-interactive CI output) conflicts.
  if (values.tui) {
    if (multi) {
      throw new Error(
        'invalid --tui: cannot drive a multi-instance config interactively — the TUI drives one in-process engine (start without --tui to boot the group)',
      )
    }
    if (values.json) {
      throw new Error(
        'invalid --tui: --json is non-interactive CI output and conflicts with the interactive TUI',
      )
    }

    const service = services[0] as (typeof services)[number]
    // --watch still hot-reloads under the TUI (single-instance path), with reload
    // warnings flowing through the TUI logger like every other line.
    const watch: CreateServerOptions['watch'] = values.watch
      ? {
          paths: await resolveWatchPaths({ configPath: values.config }),
          reload: () => loadConfig({ configPath: values.config }),
        }
      : undefined

    const tui = options.tui ?? createTui()
    const server = createServer(service, { logger: tui.logger, watch })
    await server.listen()
    await tui.run({ control: server.control, definitions: service.definitions })
    await server.close()
    return undefined
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

  // Multi-instance shares **one** request-log store (ADR-0017): every instance
  // records into it tagged by `service`, so the `--ui` aggregator's logs view (and a
  // per-instance `/__decoy__/sessions/{id}/logs`) yields one cross-service timeline. The
  // store is wrapped as a {@link SharedRequestLogStore} so each instance acquires a
  // holder handle and the store closes once after the last instance closes (#80) —
  // running its sqlite `cleanup: 'on-exit'` file removal on graceful shutdown. Its
  // config comes from the first service's `requestLog` (memory by default). A
  // single-instance config keeps its own per-service store (nothing to aggregate).
  const sharedRequestLog: SharedRequestLogStore | undefined = multi
    ? createSharedRequestLogStore(createRequestLogStore(services[0]?.requestLog))
    : undefined
  const servers = services.map((service, index) =>
    createServer(service, { logger, watch: watchFor(index), requestLog: sharedRequestLog }),
  )
  await Promise.all(servers.map((server) => server.listen()))

  // Web control panel (#66, ADR-0017): lazily resolve the optional `@decoy/ui`
  // package and serve its prebuilt SPA — plus the same-origin data API backed by
  // in-process references to the running instances — on its own loopback port. If
  // the package is not installed, fail closed with a friendly install hint and
  // leave the mock server(s) running.
  if (values.ui) {
    const resolveUi = options.resolveUi ?? (() => import('@decoy/ui'))
    let assetDir: string | undefined
    try {
      const ui = await resolveUi()
      assetDir = ui.uiAssetDir()
      // @decoy/ui and @decoy/server are published together; a drift between them
      // can mean the panel calls a control endpoint the server does not serve.
      if (ui.version !== decoyVersion) {
        logger.warn(
          `decoy ui: @decoy/ui ${ui.version} does not match decoy ${decoyVersion} — install matching versions to avoid panel/server drift`,
        )
      }
    } catch {
      out('decoy: --ui needs the @decoy/ui package — run `pnpm add -D @decoy/ui` to install it')
    }
    if (assetDir !== undefined) {
      const uiPort = values['ui-port'] !== undefined ? Number(values['ui-port']) : DEFAULT_UI_PORT
      if (!Number.isInteger(uiPort) || uiPort < 0) {
        throw new Error(`invalid --ui-port: ${values['ui-port']}`)
      }
      const ui = createUiServer(servers, {
        assetDir,
        port: uiPort,
        host: values['ui-host'],
        logger,
      })
      const boundUiPort = await ui.listen()
      logger.info(`decoy ui on http://localhost:${boundUiPort}`)
      options.onUiServer?.(ui)
    }
  }

  if (servers.length === 1) {
    return servers[0] as DecoyServer
  }
  // Multi-instance: each instance holds a handle on the shared store and closes it
  // on shutdown, so closing every instance releases the store exactly once — a
  // sqlite `cleanup: 'on-exit'` store runs its file cleanup on graceful shutdown
  // (#78), now via the store's own ref-counted close seam rather than a CLI wrapper.
  return servers
}
