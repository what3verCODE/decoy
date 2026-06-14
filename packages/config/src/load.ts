import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { dirname, extname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Collection, Definitions, Route } from '@decoy/core'
import { createJiti } from 'jiti'
import type { DecoyConfig, ServiceConfig } from './define-config'
import { MOCK_EXTENSIONS, parseDataFile } from './parse'

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

/** A fully resolved, ready-to-serve service. */
export interface LoadedService {
  name: string
  port: number
  defaultCollection: string
  definitions: Definitions
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

async function loadConfigFile(filePath: string): Promise<DecoyConfig> {
  const ext = extname(filePath).toLowerCase()
  if (ext === '.json' || ext === '.yaml' || ext === '.yml') {
    return (await parseDataFile(filePath)) as DecoyConfig
  }
  // .ts / .js / .mjs — loaded via jiti so configs may carry typed JS.
  const jiti = createJiti(pathToFileURL(filePath).href)
  return (await jiti.import(filePath, { default: true })) as DecoyConfig
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

async function loadRoutes(
  service: ServiceConfig,
  baseDir: string,
  collectionsFile: string,
): Promise<Map<string, Route>> {
  const routes = new Map<string, Route>()
  for (const route of service.routes ?? []) {
    routes.set(route.id, route)
  }

  const routesDir = resolve(baseDir, service.routesDir ?? DEFAULT_ROUTES_DIR)
  if (existsSync(routesDir)) {
    for (const file of await walk(routesDir)) {
      if (resolve(file) === collectionsFile) {
        continue
      }
      const route = (await parseDataFile(file)) as Route
      routes.set(route.id, route)
    }
  }
  return routes
}

async function loadCollections(
  service: ServiceConfig,
  collectionsFile: string,
): Promise<Map<string, Collection>> {
  const collections = new Map<string, Collection>()
  for (const collection of service.collections ?? []) {
    collections.set(collection.id, collection)
  }

  if (existsSync(collectionsFile)) {
    const data = await parseDataFile(collectionsFile)
    const list = Array.isArray(data) ? (data as Collection[]) : [data as Collection]
    for (const collection of list) {
      collections.set(collection.id, collection)
    }
  }
  return collections
}

/**
 * Resolve and load the active service. A request without a config file falls
 * back to the default-path source (`mocks/routes` + `mocks/collections.yaml`);
 * with neither present, this panics (throws) — the fail-fast startup contract.
 */
export async function loadConfig(opts?: {
  cwd?: string
  configPath?: string
}): Promise<LoadedService> {
  const cwd = opts?.cwd ?? process.cwd()
  const configFile = opts?.configPath ? resolve(cwd, opts.configPath) : findConfigFile(cwd)

  let service: ServiceConfig
  let baseDir: string

  if (configFile) {
    if (!existsSync(configFile)) {
      throw new Error(`decoy config not found: ${configFile}`)
    }
    const loaded = await loadConfigFile(configFile)
    const services = Array.isArray(loaded) ? loaded : [loaded]
    if (services.length === 0) {
      throw new Error('decoy config defines no services')
    }
    if (services.length > 1) {
      throw new Error('multi-instance config (array form) is not supported yet — see #45')
    }
    service = services[0] as ServiceConfig
    baseDir = dirname(configFile)
  } else {
    baseDir = cwd
    const hasDefaultSource =
      existsSync(resolve(baseDir, DEFAULT_ROUTES_DIR)) ||
      existsSync(resolve(baseDir, DEFAULT_COLLECTIONS_FILE))
    if (!hasDefaultSource) {
      throw new Error(
        `no decoy config found and no default-path source present (looked for a ${CONFIG_NAMES[0]} variant, ${DEFAULT_ROUTES_DIR}/, or ${DEFAULT_COLLECTIONS_FILE} under ${cwd})`,
      )
    }
    service = { port: DEFAULT_PORT }
  }

  const collectionsFile = resolve(baseDir, service.collectionsFile ?? DEFAULT_COLLECTIONS_FILE)
  const routes = await loadRoutes(service, baseDir, collectionsFile)
  const collections = await loadCollections(service, collectionsFile)

  if (collections.size === 0) {
    throw new Error('decoy: no collections defined — at least one collection is required to boot')
  }

  const firstCollection = collections.keys().next().value
  const defaultCollection = service.defaultCollection ?? firstCollection
  if (defaultCollection === undefined || !collections.has(defaultCollection)) {
    throw new Error(`decoy: defaultCollection "${defaultCollection}" is not defined`)
  }

  return {
    name: service.name ?? 'decoy',
    port: service.port ?? DEFAULT_PORT,
    defaultCollection,
    definitions: { routes, collections },
  }
}
