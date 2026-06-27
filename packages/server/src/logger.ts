import type { VariantAddress } from '@decoy/core'

/**
 * The outcome of matching one request — the structured tail of a {@link RequestLog}.
 * Mirrors the three terminal paths of the request handler: a matched variant, a
 * fail-closed miss, or a forwarded passthrough.
 */
export type RequestOutcome =
  | { type: 'matched'; address: VariantAddress }
  | { type: 'miss'; reason: string }
  | { type: 'passthrough'; target: string }

/**
 * One structured per-request log record: exactly one is
 * emitted per request, covering matched / miss / passthrough, and carrying status,
 * latency and the resolved session.
 */
export interface RequestLog {
  method: string
  path: string
  outcome: RequestOutcome
  status: number
  /** Wall-clock request latency in milliseconds. */
  latencyMs: number
  /** The resolved session: `'global'` (no/empty `x-mock-session`) or the session id. */
  session: string
}

/** Minimal leveled logger: lifecycle messages plus the structured per-request line. */
export interface Logger {
  info(message: string): void
  warn(message: string): void
  /**
   * Emit one structured line for a completed request. Matched and passthrough log
   * at info; a miss logs at warn.
   */
  request(log: RequestLog): void
}

export interface LoggerOptions {
  /** Emit machine-readable JSON lines (for CI) instead of pretty text. */
  json?: boolean
  /** Info/stdout sink (matched, passthrough, lifecycle info). Defaults to `console.log`. */
  out?: (line: string) => void
  /** Warn/stderr sink (miss, lifecycle warn). Defaults to `console.warn`. */
  err?: (line: string) => void
}

/** One decimal place — enough to read latency, not so much it's noise. */
function roundLatency(latencyMs: number): number {
  return Number(latencyMs.toFixed(1))
}

function describeOutcome(outcome: RequestOutcome): string {
  switch (outcome.type) {
    case 'matched': {
      const { route, preset, variant } = outcome.address
      return `${route}:${preset}:${variant}`
    }
    case 'miss':
      return `MISS(${outcome.reason})`
    case 'passthrough':
      return `PASSTHROUGH(${outcome.target})`
  }
}

function formatPretty(log: RequestLog): string {
  return `${log.method} ${log.path} → ${describeOutcome(log.outcome)} ${log.status} ${roundLatency(log.latencyMs)}ms (${log.session})`
}

function formatJson(log: RequestLog): string {
  const base = {
    method: log.method,
    path: log.path,
    status: log.status,
    latencyMs: roundLatency(log.latencyMs),
    session: log.session,
  }
  switch (log.outcome.type) {
    case 'matched':
      return JSON.stringify({ ...base, outcome: 'matched', ...log.outcome.address })
    case 'miss':
      return JSON.stringify({ ...base, outcome: 'miss', reason: log.outcome.reason })
    case 'passthrough':
      return JSON.stringify({ ...base, outcome: 'passthrough', target: log.outcome.target })
  }
}

/**
 * Build a {@link Logger}. The default renders pretty text for dev; `json: true`
 * emits one machine-readable JSON line per call (request lines and lifecycle
 * messages alike) so the whole stream is parseable in CI. A miss goes to the
 * `err` sink (warn level); everything else to `out`.
 */
export function createLogger(options: LoggerOptions = {}): Logger {
  const out = options.out ?? ((line: string) => console.log(line))
  const err = options.err ?? ((line: string) => console.warn(line))
  const json = options.json ?? false

  const lifecycle = (level: 'info' | 'warn', message: string): string =>
    json ? JSON.stringify({ level, message }) : message
  const format = json ? formatJson : formatPretty

  return {
    info(message) {
      out(lifecycle('info', message))
    },
    warn(message) {
      err(lifecycle('warn', message))
    },
    request(log) {
      const line = format(log)
      if (log.outcome.type === 'miss') {
        err(line)
      } else {
        out(line)
      }
    },
  }
}

/** The default pretty, console-backed logger. */
export const consoleLogger: Logger = createLogger()
