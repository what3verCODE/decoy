import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http'
import { extname, join, normalize, sep } from 'node:path'
import { handleAdmin, isAdminPath } from './admin'
import { consoleLogger, type Logger } from './logger'
import type { DecoyServer } from './server'

/** The path prefix the UI server mounts its (same-origin) data API under. */
const UI_ADMIN_PREFIX = '/admin'

/** A running `--ui` server: the web control panel on its own loopback port. */
export interface DecoyUiServer {
  /** Start listening; resolves with the actual bound port. */
  listen(): Promise<number>
  /** Stop listening. */
  close(): Promise<void>
  /** The underlying Node server. */
  readonly raw: Server
}

export interface CreateUiServerOptions {
  /** Absolute path to the prebuilt `@decoy/ui` SPA assets (contains `index.html`). */
  assetDir: string
  /**
   * Interface to bind and the extra hostname accepted in the `Host` header beyond
   * loopback (ADR-0017). Defaults to `127.0.0.1` (loopback only). Set it to
   * deliberately expose the panel past localhost; a non-loopback value prints a
   * one-time exposure warning.
   */
  host?: string
  /** Port to listen on; `0` (the default) asks the OS for an ephemeral port. */
  port?: number
  logger?: Logger
}

/** Loopback hostnames always accepted in the `Host` header (anti-DNS-rebinding). */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

/** The bare hostname of a `Host` header value (port and IPv6 brackets stripped, lower-cased). */
function hostnameOf(hostHeader: string | undefined): string {
  if (!hostHeader) {
    return ''
  }
  try {
    return new URL(`http://${hostHeader}`).hostname.replace(/^\[|\]$/g, '').toLowerCase()
  } catch {
    return ''
  }
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
}

/** Path of a request, ignoring the query string. */
function pathOf(url: string | undefined): string {
  return new URL(url ?? '/', 'http://localhost').pathname
}

/** The `?service=<name>` selector naming which instance a control request targets. */
function serviceOf(url: string | undefined): string | null {
  return new URL(url ?? '/', 'http://localhost').searchParams.get('service')
}

/**
 * Pick the instance a `?service=` control request targets: the one whose name
 * matches, else the first (the degenerate single-service default, and the safe
 * fallback for an unknown name — the switcher only ever offers known services).
 */
function selectInstance(instances: DecoyServer[], name: string | null): DecoyServer | undefined {
  if (name !== null) {
    const match = instances.find((instance) => instance.name === name)
    if (match) {
      return match
    }
  }
  return instances[0]
}

/**
 * Resolve a request path to a file under `assetDir`, defending against `..`
 * traversal. Returns the asset path, or `undefined` if it escapes the root.
 */
function assetPath(assetDir: string, urlPath: string): string | undefined {
  const rel = normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, '')
  const resolved = join(assetDir, rel)
  if (resolved !== assetDir && !resolved.startsWith(assetDir + sep)) {
    return undefined
  }
  return resolved
}

/** Stream a static file; resolves `false` if it is not a readable file. */
async function serveStatic(res: ServerResponse, file: string): Promise<boolean> {
  try {
    const info = await stat(file)
    if (!info.isFile()) {
      return false
    }
    res.statusCode = 200
    res.setHeader('content-type', CONTENT_TYPES[extname(file)] ?? 'application/octet-stream')
    createReadStream(file).pipe(res)
    return true
  } catch {
    return false
  }
}

/**
 * Create the `--ui` web control panel server (ADR-0017). It serves the prebuilt
 * `@decoy/ui` SPA from `assetDir` and — under the same origin, with no CORS — the
 * read/control data API backed by **direct in-process references** to the running
 * mock instances. Bound to loopback by the caller; unmatched non-API paths fall
 * back to `index.html` (SPA client-side routing).
 */
export function createUiServer(
  instances: DecoyServer[],
  options: CreateUiServerOptions,
): DecoyUiServer {
  const logger = options.logger ?? consoleLogger
  const { assetDir } = options
  // The aggregator's logs view reads **one shared store** (ADR-0017): the CLI
  // injects the same store into every instance, so any instance's `requestLog` is
  // that shared store, holding every service's records (each tagged by `service`).
  // Control/catalog endpoints target a `?service=`-selected instance; logs are
  // always read from this shared store, so they aggregate across services.
  const sharedStore = instances[0]?.requestLog

  const bindHost = options.host ?? '127.0.0.1'
  const bindPort = options.port ?? 0
  const override = hostnameOf(bindHost)
  const allowedHosts = new Set(LOOPBACK_HOSTS)
  if (override) {
    allowedHosts.add(override)
    if (!LOOPBACK_HOSTS.has(override)) {
      logger.warn(
        `decoy ui: host "${bindHost}" exposes the control panel beyond localhost — anyone who can reach it can control your mocks and read request logs`,
      )
    }
  }

  const raw = createHttpServer((req, res) => {
    void handle(req, res).catch((error: unknown) => {
      res.statusCode = 500
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ error: 'internal decoy ui error' }))
      logger.warn(`ui request failed: ${error instanceof Error ? error.message : String(error)}`)
    })
  })

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Anti-DNS-rebinding (ADR-0017): only loopback (plus an explicit override) may
    // reach the panel, so a malicious site cannot rebind a name to this port.
    if (!allowedHosts.has(hostnameOf(req.headers.host))) {
      res.statusCode = 403
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ error: 'decoy ui: forbidden host (loopback only)' }))
      return
    }

    // Same-origin data API (no CORS): drive the in-process instances directly.
    if (sharedStore && isAdminPath(req.url, UI_ADMIN_PREFIX)) {
      // The service axis (ADR-0017): list every instance for the SPA's switcher.
      if (req.method === 'GET' && pathOf(req.url) === `${UI_ADMIN_PREFIX}/services`) {
        res.statusCode = 200
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify(instances.map((instance) => ({ name: instance.name }))))
        return
      }
      // Control/catalog routes to the `?service=`-selected instance (per-instance);
      // logs read the shared store (aggregated across services), so the timeline is
      // one cross-service stream regardless of the selected service.
      const target = selectInstance(instances, serviceOf(req.url)) ?? instances[0]
      if (target) {
        await handleAdmin(
          req,
          res,
          target.sessions,
          UI_ADMIN_PREFIX,
          logger,
          target.definitions,
          sharedStore,
          { missStatus: target.missStatus, passthrough: target.passthrough },
        )
        return
      }
    }

    const urlPath = pathOf(req.url)
    const file = assetPath(assetDir, urlPath)
    if (file && (await serveStatic(res, file))) {
      return
    }
    // SPA fallback: any unmatched path renders the app shell.
    await serveStatic(res, join(assetDir, 'index.html'))
  }

  return {
    raw,
    listen() {
      return new Promise<number>((resolvePort, reject) => {
        const onError = (error: Error) => reject(error)
        raw.once('error', onError)
        raw.listen(bindPort, bindHost, () => {
          raw.removeListener('error', onError)
          const address = raw.address()
          resolvePort(typeof address === 'object' && address ? address.port : bindPort)
        })
      })
    },
    close() {
      return new Promise<void>((resolveClose, reject) => {
        raw.close((error) => (error ? reject(error) : resolveClose()))
      })
    },
  }
}
