import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { dirname, extname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Collection, Definitions, Route } from '@decoy/core'
import { createJiti } from 'jiti'
import type { AdminConfig, DecoyConfig, PassthroughConfig, ServiceConfig } from './define-config'
import { MOCK_EXTENSIONS } from './parse'
import {
  bindLineAt,
  inlineSourceDoc,
  loadSourceDoc,
  type SourceDoc,
  type ValuePath,
} from './source'
import {
  hasErrors,
  type RawCollection,
  type RawRoute,
  ValidationError,
  type ValidationInput,
  type ValidationIssue,
  validateSources,
} from './validate'

/** Candidate config file names, in resolution order. */
const CONFIG_NAMES = [
  'decoy.config.ts',
  'decoy.config.mjs',
  'decoy.config.js',
  'decoy.config.json',
  'decoy.config.yaml',
  'decoy.config.yml',
]

const DEFAULT_ROUTES_DIR = 'mocks/routes'
const DEFAULT_COLLECTIONS_FILE = 'mocks/collections.yaml'
const DEFAULT_PORT = 4000
const DEFAULT_ADMIN_PREFIX = '/admin'
const DEFAULT_MISS_STATUS = 501
/** 30 minutes — long enough to outlive a slow e2e test, short enough to reclaim abandoned sessions. */
const DEFAULT_SESSION_IDLE_TTL_MS = 30 * 60 * 1000

/** Resolved `/admin` control API mount: enabled flag, path prefix, and optional separate port. */
export interface ResolvedAdmin {
  enabled: boolean
  /** Path prefix the admin API is mounted under, leading `/`, no trailing `/` (e.g. `/admin`). */
  prefix: string
  /** When set, the admin API listens on this dedicated port instead of the service port. */
  port?: number
}

/** Resolved global passthrough target (ADR-0005): a normalized upstream base URL. */
export interface ResolvedPassthrough {
  /** Upstream base URL with any trailing slash trimmed, ready to prefix `{path}{query}`. */
  url: string
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
  /** Resolved `/admin` control API mount (ADR-0010). */
  admin: ResolvedAdmin
}

/** Normalize a path prefix to a leading `/` and no trailing `/`. */
function normalizePrefix(prefix: string): string {
  const trimmed = prefix.trim().replace(/\/+$/, '')
  if (trimmed === '') {
    return DEFAULT_ADMIN_PREFIX
  }
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
}

/** Resolve the authoring `admin` config into a {@link ResolvedAdmin} (default: on, same port, `/admin`). */
function resolveAdmin(admin: AdminConfig | undefined): ResolvedAdmin {
  if (admin === undefined || admin === true) {
    return { enabled: true, prefix: DEFAULT_ADMIN_PREFIX }
  }
  if (admin === false) {
    return { enabled: false, prefix: DEFAULT_ADMIN_PREFIX }
  }
  return {
    enabled: true,
    prefix: normalizePrefix(admin.prefix ?? DEFAULT_ADMIN_PREFIX),
    port: admin.port,
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

function findConfigFile(cwd: string): string | undefined {
  for (const name of CONFIG_NAMES) {
    const candidate = join(cwd, name)
    if (existsSync(candidate)) {
      return candidate
    }
  }
  return undefined
}

/** Load the config file into a line-aware {@link SourceDoc} (declarative formats keep lines; TS/JS do not). */
async function loadConfigDoc(filePath: string): Promise<SourceDoc> {
  const ext = extname(filePath).toLowerCase()
  if (ext === '.json' || ext === '.yaml' || ext === '.yml') {
    return loadSourceDoc(filePath)
  }
  // .ts / .js / .mjs — loaded via jiti so configs may carry typed JS (no source lines).
  const jiti = createJiti(pathToFileURL(filePath).href)
  const data = (await jiti.import(filePath, { default: true })) as DecoyConfig
  return inlineSourceDoc(filePath, data)
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
}

async function collectRouteSources(
  service: ServiceConfig,
  baseDir: string,
  collectionsFile: string,
  configDoc: SourceDoc | undefined,
  serviceBase: ValuePath,
): Promise<RawRoute[]> {
  const sources: RawRoute[] = []

  // Inline routes declared in the config entry.
  ;(service.routes ?? []).forEach((route, index) => {
    sources.push({
      data: route,
      file: configDoc?.file ?? '<inline>',
      lineAt: configDoc
        ? bindLineAt(configDoc, [...serviceBase, 'routes', index])
        : () => undefined,
    })
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
  configDoc: SourceDoc | undefined,
  serviceBase: ValuePath,
): Promise<RawCollection[]> {
  const sources: RawCollection[] = []

  // Inline collections declared in the config entry.
  ;(service.collections ?? []).forEach((collection, index) => {
    sources.push({
      data: collection,
      file: configDoc?.file ?? '<inline>',
      lineAt: configDoc
        ? bindLineAt(configDoc, [...serviceBase, 'collections', index])
        : () => undefined,
    })
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
  /** The loaded, line-aware config document (absent on the default-path source). */
  configDoc?: SourceDoc
  /** Where this service sits in the config doc (`[]` single form, `[0]` array form). */
  serviceBase: ValuePath
}

/**
 * Resolve the active source: a `decoy.config.*` file or the default-path source
 * (`mocks/routes` + `mocks/collections.yaml`). Panics (throws) when neither can
 * be resolved — the one fail-fast-on-first exception to aggregate validation.
 */
async function resolveSourceLayout(opts?: {
  cwd?: string
  configPath?: string
}): Promise<SourceLayout> {
  const cwd = opts?.cwd ?? process.cwd()
  const configFile = opts?.configPath ? resolve(cwd, opts.configPath) : findConfigFile(cwd)

  if (configFile) {
    if (!existsSync(configFile)) {
      throw new Error(`decoy config not found: ${configFile}`)
    }
    const configDoc = await loadConfigDoc(configFile)
    const loaded = configDoc.data as DecoyConfig
    const services = Array.isArray(loaded) ? loaded : [loaded]
    if (services.length === 0) {
      throw new Error('decoy config defines no services')
    }
    if (services.length > 1) {
      throw new Error('multi-instance config (array form) is not supported yet — see #45')
    }
    return {
      service: services[0] as ServiceConfig,
      baseDir: dirname(configFile),
      configFile,
      configDoc,
      serviceBase: Array.isArray(loaded) ? [0] : [],
    }
  }

  const baseDir = cwd
  const hasDefaultSource =
    existsSync(resolve(baseDir, DEFAULT_ROUTES_DIR)) ||
    existsSync(resolve(baseDir, DEFAULT_COLLECTIONS_FILE))
  if (!hasDefaultSource) {
    throw new Error(
      `no decoy config found and no default-path source present (looked for a ${CONFIG_NAMES[0]} variant, ${DEFAULT_ROUTES_DIR}/, or ${DEFAULT_COLLECTIONS_FILE} under ${cwd})`,
    )
  }
  return { service: { port: DEFAULT_PORT }, baseDir, serviceBase: [] }
}

/**
 * Resolve the source (config file or default paths) and read every route and
 * collection into line-aware sources. Panics (throws) only when no source can be
 * resolved — the one fail-fast-on-first exception to aggregate validation.
 */
async function collectSources(opts?: {
  cwd?: string
  configPath?: string
}): Promise<CollectedSources> {
  const { service, baseDir, configDoc, serviceBase } = await resolveSourceLayout(opts)

  const collectionsFile = resolve(baseDir, service.collectionsFile ?? DEFAULT_COLLECTIONS_FILE)
  const routes = await collectRouteSources(
    service,
    baseDir,
    collectionsFile,
    configDoc,
    serviceBase,
  )
  const collections = await collectCollectionSources(
    service,
    collectionsFile,
    configDoc,
    serviceBase,
  )

  return {
    service,
    config: configDoc
      ? { data: service, file: configDoc.file, lineAt: bindLineAt(configDoc, serviceBase) }
      : undefined,
    routes,
    collections,
  }
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
 * Run aggregate validation over the resolved source (config or default paths)
 * and return **all** issues with `file:line`, without throwing on validation
 * errors. Reused by `decoy check` (#37) and the loader. Still panics when no
 * source can be resolved (the fail-fast startup contract).
 */
export async function validateConfig(opts?: {
  cwd?: string
  configPath?: string
}): Promise<ValidationIssue[]> {
  const sources = await collectSources(opts)
  return validateSources(sources)
}

/**
 * Resolve the filesystem paths a dev hot reload (#44) should watch for the active
 * source: the `decoy.config.*` file (when booting from one), the `routesDir`, and
 * the `collectionsFile`. Only paths that currently exist are returned — a watcher
 * can't subscribe to a missing one, and a later-created file lands under a watched
 * dir. Panics (throws) when no source resolves, like {@link loadConfig}.
 */
export async function resolveWatchPaths(opts?: {
  cwd?: string
  configPath?: string
}): Promise<string[]> {
  const { service, baseDir, configFile } = await resolveSourceLayout(opts)

  const routesDir = resolve(baseDir, service.routesDir ?? DEFAULT_ROUTES_DIR)
  const collectionsFile = resolve(baseDir, service.collectionsFile ?? DEFAULT_COLLECTIONS_FILE)

  const candidates = [configFile, routesDir, collectionsFile].filter(
    (path): path is string => path !== undefined,
  )
  // De-dupe (collectionsFile can sit inside routesDir) and keep only existing paths.
  return [...new Set(candidates)].filter((path) => existsSync(path))
}

/**
 * Resolve and load the active service. A request without a config file falls
 * back to the default-path source (`mocks/routes` + `mocks/collections.yaml`);
 * with neither present, this panics (throws) — the fail-fast startup contract.
 * Aggregate validation runs at load: any validation **error** throws a
 * {@link ValidationError} carrying every issue (warnings do not block boot).
 */
export async function loadConfig(opts?: {
  cwd?: string
  configPath?: string
}): Promise<LoadedService> {
  const sources = await collectSources(opts)

  const issues = validateSources(sources)
  if (hasErrors(issues)) {
    throw new ValidationError(issues)
  }

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

  return {
    name: service.name ?? 'decoy',
    port: service.port ?? DEFAULT_PORT,
    defaultCollection,
    missStatus: service.missStatus ?? DEFAULT_MISS_STATUS,
    passthrough: resolvePassthrough(service.passthrough),
    sessionIdleTtlMs: service.sessionIdleTtl ?? DEFAULT_SESSION_IDLE_TTL_MS,
    definitions,
    admin: resolveAdmin(service.admin),
  }
}
