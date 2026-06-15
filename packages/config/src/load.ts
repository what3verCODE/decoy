import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { dirname, extname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Collection, Definitions, Route } from '@decoy/core'
import { cosmiconfig, defaultLoaders, type Loader, type PublicExplorer } from 'cosmiconfig'
import { createJiti } from 'jiti'
import type {
  ControlConfig,
  DecoyConfig,
  PassthroughConfig,
  RequestLogConfig,
  ServiceConfig,
} from './define-config'
import { MOCK_EXTENSIONS } from './parse'
import { resolveLogPath } from './request-log'
import { bindLineAt, loadSourceDoc, type ValuePath } from './source'
import {
  hasErrors,
  type RawCollection,
  type RawRoute,
  ValidationError,
  type ValidationInput,
  type ValidationIssue,
  validateSources,
} from './validate'

/**
 * The config file names cosmiconfig searches, in resolution order. `.ts/.js/.mjs/
 * .cjs` are loaded through a jiti-backed loader (see {@link createConfigExplorer});
 * `.json/.yaml/.yml` use cosmiconfig's bundled declarative loaders.
 */
const CONFIG_SEARCH_PLACES = [
  'decoy.config.ts',
  'decoy.config.mjs',
  'decoy.config.cjs',
  'decoy.config.js',
  'decoy.config.json',
  'decoy.config.yaml',
  'decoy.config.yml',
]

const DEFAULT_ROUTES_DIR = 'mocks/routes'
const DEFAULT_COLLECTIONS_FILE = 'mocks/collections.yaml'
const DEFAULT_PORT = 4000
/** Collision-safe default control mount prefix (ADR-0010); won't shadow a real upstream route. */
const DEFAULT_CONTROL_PREFIX = '/__decoy__'
const DEFAULT_MISS_STATUS = 501
/** 30 minutes — long enough to outlive a slow e2e test, short enough to reclaim abandoned sessions. */
const DEFAULT_SESSION_IDLE_TTL_MS = 30 * 60 * 1000
/** Default sqlite filename under a gitignored `.decoy/`, namespaced by service name (#70). */
const DEFAULT_LOG_PATH_TEMPLATE = '.decoy/{name}.sqlite'

/** Resolved control API mount: enabled flag, path prefix, and optional separate port. */
export interface ResolvedControl {
  enabled: boolean
  /** Path prefix the control API is mounted under, leading `/`, no trailing `/` (e.g. `/__decoy__`). */
  prefix: string
  /** When set, the control API listens on this dedicated port instead of the service port. */
  port?: number
}

/** Resolved global passthrough target (ADR-0005): a normalized upstream base URL. */
export interface ResolvedPassthrough {
  /** Upstream base URL with any trailing slash trimmed, ready to prefix `{path}{query}`. */
  url: string
}

/** Resolved durable request-log store (#70): the boot-ready store selection. */
export interface ResolvedRequestLog {
  /** Backing store: process-bound memory (default) or a `node:sqlite` file. */
  store: 'memory' | 'sqlite'
  /** Absolute sqlite file path (template already expanded at boot); absent for memory. */
  path?: string
  /** Ring-evict the oldest records past this count; unset uses the store default. */
  maxRows?: number
  /** Sqlite cleanup mode; `'never'` for the memory store (cleanup is a no-op there). */
  cleanup: 'on-exit' | 'on-session-end' | 'never'
}

/** A fully resolved, ready-to-serve service. */
export interface LoadedService {
  name: string
  port: number
  defaultCollection: string
  /** HTTP status returned for a fail-closed miss (ADR-0005); defaults to 501. */
  missStatus: number
  /**
   * Global passthrough target (ADR-0005): when set, unmatched requests are
   * forwarded verbatim here instead of failing closed. Absent = off (the default).
   */
  passthrough?: ResolvedPassthrough
  /** Idle TTL (ms) after which an abandoned session is reaped (ADR-0011); defaults to 30 min. */
  sessionIdleTtlMs: number
  definitions: Definitions
  /** Resolved control API mount (ADR-0010). */
  control: ResolvedControl
  /**
   * Resolved durable request-log store (#70). Always set by the loader; optional
   * so an embedding adapter that hand-builds a {@link LoadedService} can omit it
   * and get the in-memory default (`createServer` falls back to memory).
   */
  requestLog?: ResolvedRequestLog
}

/** Normalize a path prefix to a leading `/` and no trailing `/`. */
function normalizePrefix(prefix: string): string {
  const trimmed = prefix.trim().replace(/\/+$/, '')
  if (trimmed === '') {
    return DEFAULT_CONTROL_PREFIX
  }
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
}

/** Resolve the authoring `control` config into a {@link ResolvedControl} (default: on, same port, `/__decoy__`). */
function resolveControl(control: ControlConfig | undefined): ResolvedControl {
  if (control === undefined || control === true) {
    return { enabled: true, prefix: DEFAULT_CONTROL_PREFIX }
  }
  if (control === false) {
    return { enabled: false, prefix: DEFAULT_CONTROL_PREFIX }
  }
  return {
    enabled: true,
    prefix: normalizePrefix(control.prefix ?? DEFAULT_CONTROL_PREFIX),
    port: control.port,
  }
}

/** Resolve the authoring `passthrough` config into a {@link ResolvedPassthrough} (trailing slash trimmed); `undefined` = off. */
function resolvePassthrough(
  passthrough: PassthroughConfig | undefined,
): ResolvedPassthrough | undefined {
  if (passthrough === undefined) {
    return undefined
  }
  return { url: passthrough.url.replace(/\/+$/, '') }
}

/** Load a `.ts/.js/.mjs/.cjs` config through jiti so configs may carry typed JS. */
const jitiLoader: Loader = (filepath) => {
  const jiti = createJiti(pathToFileURL(filepath).href)
  return jiti.import(filepath, { default: true })
}

/**
 * A cosmiconfig explorer for the `decoy` module: discovery + reading of the config
 * file (the existing `decoy.config.*` names). `.ts/.js/.mjs/.cjs` load through
 * {@link jitiLoader} (cosmiconfig cannot transpile TS itself); declarative formats
 * use the bundled loaders. `searchStrategy: 'none'` searches only the start dir
 * (matching the previous cwd-only discovery), and `cache: false` keeps a hot
 * reload (#44/#51) re-reading the file from disk rather than serving a stale load.
 */
function createConfigExplorer(): PublicExplorer {
  return cosmiconfig('decoy', {
    searchStrategy: 'none',
    searchPlaces: CONFIG_SEARCH_PLACES,
    cache: false,
    loaders: {
      ...defaultLoaders,
      '.ts': jitiLoader,
      '.js': jitiLoader,
      '.mjs': jitiLoader,
      '.cjs': jitiLoader,
    },
  })
}

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await walk(full)))
    } else if (MOCK_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      files.push(full)
    }
  }
  return files
}

/** The collected, line-aware sources of one service — ready to validate and assemble. */
interface CollectedSources {
  service: ServiceConfig
  /** Config source for schema validation; absent when booting from default paths. */
  config?: ValidationInput['config']
  routes: RawRoute[]
  collections: RawCollection[]
  /** Directory the service's relative paths resolve against (e.g. the sqlite log path). */
  baseDir: string
}

async function collectRouteSources(
  service: ServiceConfig,
  baseDir: string,
  collectionsFile: string,
  configFile: string | undefined,
): Promise<RawRoute[]> {
  const sources: RawRoute[] = []

  // Inline routes declared in the config entry — located by the config file, no line
  // (config-file line tracking was dropped with the move to cosmiconfig).
  ;(service.routes ?? []).forEach((route) => {
    sources.push({ data: route, file: configFile ?? '<inline>', lineAt: () => undefined })
  })

  // File-based routes under routesDir (recursive).
  const routesDir = resolve(baseDir, service.routesDir ?? DEFAULT_ROUTES_DIR)
  if (existsSync(routesDir)) {
    for (const file of await walk(routesDir)) {
      if (resolve(file) === collectionsFile) {
        continue
      }
      const doc = await loadSourceDoc(file)
      sources.push({ data: doc.data, file, lineAt: bindLineAt(doc) })
    }
  }
  return sources
}

async function collectCollectionSources(
  service: ServiceConfig,
  collectionsFile: string,
  configFile: string | undefined,
): Promise<RawCollection[]> {
  const sources: RawCollection[] = []

  // Inline collections declared in the config entry — located by the config file, no line.
  ;(service.collections ?? []).forEach((collection) => {
    sources.push({ data: collection, file: configFile ?? '<inline>', lineAt: () => undefined })
  })

  // The single collections file (an array of collections, or a lone collection).
  if (existsSync(collectionsFile)) {
    const doc = await loadSourceDoc(collectionsFile)
    if (Array.isArray(doc.data)) {
      doc.data.forEach((collection, index) => {
        sources.push({ data: collection, file: collectionsFile, lineAt: bindLineAt(doc, [index]) })
      })
    } else {
      sources.push({ data: doc.data, file: collectionsFile, lineAt: bindLineAt(doc) })
    }
  }
  return sources
}

/** The resolved source layout of a service: which config file (if any) and base dir back it. */
interface SourceLayout {
  service: ServiceConfig
  /** Directory the service's relative paths (`routesDir`, `collectionsFile`) resolve against. */
  baseDir: string
  /** The resolved config file, when booting from one (absent on the default-path source). */
  configFile?: string
  /** Where this service sits in the config (`[]` single form, `[0]` array form). */
  serviceBase: ValuePath
}

/** A service identifier for service-scoped config errors: `service "name"`, `service [index]`, or `service`. */
function describeService(service: ServiceConfig, serviceBase: ValuePath): string {
  if (typeof service.name === 'string' && service.name.length > 0) {
    return `service "${service.name}"`
  }
  if (serviceBase.length > 0) {
    return `service [${serviceBase[0]}]`
  }
  return 'service'
}

/**
 * Resolve the active source into **one layout per service**: a `decoy.config.*`
 * file (single object → one layout; array → one layout per entry, ADR-0006) or
 * the default-path source (`mocks/routes` + `mocks/collections.yaml`, always a
 * single service). Discovery + reading of the config file is owned by cosmiconfig
 * (see {@link createConfigExplorer}). Panics (throws) when neither can be resolved
 * — the one fail-fast-on-first exception to aggregate validation.
 */
async function resolveServiceLayouts(opts?: {
  cwd?: string
  configPath?: string
}): Promise<SourceLayout[]> {
  const cwd = opts?.cwd ?? process.cwd()
  const explorer = createConfigExplorer()

  let found: { config: unknown; filepath: string } | undefined
  if (opts?.configPath) {
    const configFile = resolve(cwd, opts.configPath)
    if (!existsSync(configFile)) {
      throw new Error(`decoy config not found: ${configFile}`)
    }
    const result = await explorer.load(configFile)
    if (result) {
      found = { config: result.config, filepath: result.filepath }
    }
  } else {
    const result = await explorer.search(cwd)
    if (result) {
      found = { config: result.config, filepath: result.filepath }
    }
  }

  if (found) {
    const loaded = found.config as DecoyConfig
    const isArray = Array.isArray(loaded)
    const services = isArray ? loaded : [loaded]
    if (services.length === 0) {
      throw new Error('decoy config defines no services')
    }
    const configFile = found.filepath
    const baseDir = dirname(configFile)
    return services.map((service, index) => ({
      service: service as ServiceConfig,
      baseDir,
      configFile,
      serviceBase: isArray ? [index] : [],
    }))
  }

  const baseDir = cwd
  const hasDefaultSource =
    existsSync(resolve(baseDir, DEFAULT_ROUTES_DIR)) ||
    existsSync(resolve(baseDir, DEFAULT_COLLECTIONS_FILE))
  if (!hasDefaultSource) {
    throw new Error(
      `no decoy config found and no default-path source present (looked for a decoy.config.* file, ${DEFAULT_ROUTES_DIR}/, or ${DEFAULT_COLLECTIONS_FILE} under ${cwd})`,
    )
  }
  return [{ service: { port: DEFAULT_PORT }, baseDir, serviceBase: [] }]
}

/**
 * Read every route and collection of a single resolved {@link SourceLayout} into
 * line-aware sources, ready to validate and assemble.
 */
async function collectSources(layout: SourceLayout): Promise<CollectedSources> {
  const { service, baseDir, configFile, serviceBase } = layout

  const collectionsFile = resolve(baseDir, service.collectionsFile ?? DEFAULT_COLLECTIONS_FILE)
  const routes = await collectRouteSources(service, baseDir, collectionsFile, configFile)
  const collections = await collectCollectionSources(service, collectionsFile, configFile)

  return {
    service,
    config: configFile
      ? { data: service, file: configFile, service: describeService(service, serviceBase) }
      : undefined,
    routes,
    collections,
    baseDir,
  }
}

/**
 * Resolve a service's authoring `requestLog` into a boot-ready {@link ResolvedRequestLog}
 * (#70). For `store: 'sqlite'` the filename template is expanded **once here**
 * (`{name}/{pid}/{port}` + `%…` strftime) and resolved to an absolute path under
 * `baseDir`, defaulting to a file in a gitignored `.decoy/`. `cleanup` is forced to
 * `'never'` for the memory store (it is a no-op there).
 */
function resolveRequestLog(
  config: RequestLogConfig | undefined,
  ctx: { name: string; port: number; baseDir: string },
): ResolvedRequestLog {
  const maxRows = config?.retention?.maxRows
  const withMaxRows = maxRows !== undefined ? { maxRows } : {}
  if (config?.store === 'sqlite') {
    const template = config.path ?? DEFAULT_LOG_PATH_TEMPLATE
    const expanded = resolveLogPath(template, {
      name: ctx.name,
      pid: process.pid,
      port: ctx.port,
      now: new Date(),
    })
    return {
      store: 'sqlite',
      path: resolve(ctx.baseDir, expanded),
      cleanup: config.cleanup ?? 'never',
      ...withMaxRows,
    }
  }
  return { store: 'memory', cleanup: 'never', ...withMaxRows }
}

/** Build the engine definitions from validated sources (last definition wins, matching the engine). */
function assembleDefinitions(sources: CollectedSources): Definitions {
  const routes = new Map<string, Route>()
  for (const source of sources.routes) {
    const route = source.data as Route
    routes.set(route.id, route)
  }
  const collections = new Map<string, Collection>()
  for (const source of sources.collections) {
    const collection = source.data as Collection
    collections.set(collection.id, collection)
  }
  return { routes, collections }
}

/**
 * Cross-service checks that no single service's sources can see: in a
 * multi-instance config (ADR-0006) two services must not share a listen port, or
 * the second instance's `listen()` fails with an opaque `EADDRINUSE`. The message
 * names both offending services so it surfaces in `decoy check` and blocks boot
 * (located by the config file, no line). Port `0` (ephemeral — the OS assigns a
 * free port) never collides and is exempt. Single-service sources produce no
 * cross-service issues.
 */
function crossServiceIssues(layouts: SourceLayout[]): ValidationIssue[] {
  if (layouts.length < 2) {
    return []
  }
  const issues: ValidationIssue[] = []
  const firstByPort = new Map<number, string>()
  for (const layout of layouts) {
    const port = layout.service.port ?? DEFAULT_PORT
    const name = layout.service.name ?? 'decoy'
    if (port === 0) {
      continue
    }
    const prior = firstByPort.get(port)
    if (prior !== undefined) {
      issues.push({
        severity: 'error',
        message: `duplicate port ${port}: services "${prior}" and "${name}" cannot both listen on it`,
        file: layout.configFile ?? '<config>',
      })
    } else {
      firstByPort.set(port, name)
    }
  }
  return issues
}

/**
 * Run aggregate validation over the resolved source (config or default paths)
 * and return **all** issues with `file:line`, without throwing on validation
 * errors. Each service is validated independently (so duplicate route ids across
 * services are fine — they impersonate different upstreams) and cross-service
 * checks (duplicate ports) are added on top. Reused by `decoy check` (#37) and
 * the loader. Still panics when no source can be resolved (the fail-fast startup
 * contract).
 */
export async function validateConfig(opts?: {
  cwd?: string
  configPath?: string
}): Promise<ValidationIssue[]> {
  const layouts = await resolveServiceLayouts(opts)
  const perService = await Promise.all(
    layouts.map(async (layout) => validateSources(await collectSources(layout))),
  )
  return [...crossServiceIssues(layouts), ...perService.flat()]
}

/**
 * Resolve the filesystem paths a dev hot reload (#44) should watch for the
 * **first** service the active source defines: the `decoy.config.*` file (when
 * booting from one), the `routesDir`, and the `collectionsFile`. Only paths that
 * currently exist are returned — a watcher can't subscribe to a missing one, and a
 * later-created file lands under a watched dir. Panics (throws) when no source
 * resolves, like {@link loadConfig}. For a multi-instance config (ADR-0006), use
 * {@link resolveAllWatchPaths} to watch every instance.
 */
export async function resolveWatchPaths(opts?: {
  cwd?: string
  configPath?: string
}): Promise<string[]> {
  // Single-instance hot reload (#44): watch the first service's source. A
  // multi-instance config watches each instance separately via
  // {@link resolveAllWatchPaths} (#51).
  const [layout] = await resolveServiceLayouts(opts)
  return serviceWatchPaths(layout as SourceLayout)
}

/**
 * Resolve the watch paths for **every** service the active source defines (#51):
 * one path set per instance, aligned one-to-one with {@link loadConfigs} order. A
 * single-object config yields a one-element array; an array config (ADR-0006)
 * yields one set per entry, each watching that instance's own `routesDir` and
 * `collectionsFile` plus the shared config file — so editing one service's mocks
 * re-loads only that instance, while a config-file edit re-loads them all. Panics
 * (throws) when no source resolves, like {@link resolveWatchPaths}.
 */
export async function resolveAllWatchPaths(opts?: {
  cwd?: string
  configPath?: string
}): Promise<string[][]> {
  const layouts = await resolveServiceLayouts(opts)
  return layouts.map(serviceWatchPaths)
}

/**
 * The existing filesystem paths to watch for one service: the `decoy.config.*`
 * file (when booting from one), its `routesDir`, and its `collectionsFile`. Only
 * paths that currently exist are returned — a watcher can't subscribe to a missing
 * one, and a later-created file lands under a watched dir.
 */
function serviceWatchPaths(layout: SourceLayout): string[] {
  const { service, baseDir, configFile } = layout

  const routesDir = resolve(baseDir, service.routesDir ?? DEFAULT_ROUTES_DIR)
  const collectionsFile = resolve(baseDir, service.collectionsFile ?? DEFAULT_COLLECTIONS_FILE)

  const candidates = [configFile, routesDir, collectionsFile].filter(
    (path): path is string => path !== undefined,
  )
  // De-dupe (collectionsFile can sit inside routesDir) and keep only existing paths.
  return [...new Set(candidates)].filter((path) => existsSync(path))
}

/** Assemble one validated service's sources into a ready-to-serve {@link LoadedService}. */
function buildLoadedService(sources: CollectedSources): LoadedService {
  const definitions = assembleDefinitions(sources)
  const { service } = sources

  if (definitions.collections.size === 0) {
    throw new Error('decoy: no collections defined — at least one collection is required to boot')
  }

  const firstCollection = definitions.collections.keys().next().value
  const defaultCollection = service.defaultCollection ?? firstCollection
  if (defaultCollection === undefined || !definitions.collections.has(defaultCollection)) {
    throw new Error(`decoy: defaultCollection "${defaultCollection}" is not defined`)
  }

  const name = service.name ?? 'decoy'
  const port = service.port ?? DEFAULT_PORT

  return {
    name,
    port,
    defaultCollection,
    missStatus: service.missStatus ?? DEFAULT_MISS_STATUS,
    passthrough: resolvePassthrough(service.passthrough),
    sessionIdleTtlMs: service.sessionIdleTtl ?? DEFAULT_SESSION_IDLE_TTL_MS,
    definitions,
    control: resolveControl(service.control),
    requestLog: resolveRequestLog(service.requestLog, { name, port, baseDir: sources.baseDir }),
  }
}

/**
 * Resolve and load **every** service the active source defines (ADR-0006): a
 * single-object config yields one service; an array config yields one per entry,
 * each fully independent (own routes/collections/port/passthrough). With no
 * config file, the default-path source (`mocks/routes` + `mocks/collections.yaml`)
 * yields a single service; with neither present, this panics (throws) — the
 * fail-fast startup contract. Aggregate validation (per-service + cross-service
 * duplicate ports) runs at load: any **error** throws a {@link ValidationError}
 * carrying every issue (warnings do not block boot).
 */
export async function loadConfigs(opts?: {
  cwd?: string
  configPath?: string
}): Promise<LoadedService[]> {
  const layouts = await resolveServiceLayouts(opts)
  const collected = await Promise.all(layouts.map((layout) => collectSources(layout)))

  const issues = [...crossServiceIssues(layouts), ...collected.flatMap(validateSources)]
  if (hasErrors(issues)) {
    throw new ValidationError(issues)
  }

  return collected.map(buildLoadedService)
}

/**
 * Resolve and load a **single** service — the common case. Backed by
 * {@link loadConfigs}; a config that defines more than one service throws (boot
 * the whole group with `decoy start`, which uses {@link loadConfigs}). Aggregate
 * validation runs at load: any **error** throws a {@link ValidationError}.
 */
export async function loadConfig(opts?: {
  cwd?: string
  configPath?: string
}): Promise<LoadedService> {
  const services = await loadConfigs(opts)
  if (services.length > 1) {
    throw new Error(
      `decoy config defines ${services.length} services — boot the group with \`decoy start\` (or use loadConfigs)`,
    )
  }
  return services[0] as LoadedService
}
