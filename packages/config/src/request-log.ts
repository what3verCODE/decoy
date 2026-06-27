import type { RequestLogConfig } from './define-config'
import type { ValidationIssue } from './validate'

/**
 * `%`-prefixed strftime time tokens supported in a request-log filename template,
 * each rendered from a single `Date` (UTC, so a filename is stable regardless of
 * the host timezone). `%s` is the Unix epoch in seconds; the rest are zero-padded
 * calendar fields.
 */
const TIME_TOKENS: Record<string, (now: Date) => string> = {
  Y: (now) => String(now.getUTCFullYear()).padStart(4, '0'),
  m: (now) => pad2(now.getUTCMonth() + 1),
  d: (now) => pad2(now.getUTCDate()),
  H: (now) => pad2(now.getUTCHours()),
  M: (now) => pad2(now.getUTCMinutes()),
  S: (now) => pad2(now.getUTCSeconds()),
  s: (now) => String(Math.floor(now.getTime() / 1000)),
}

/** `{}`-wrapped named identifiers resolved from the boot context. */
const NAME_TOKENS = ['name', 'pid', 'port'] as const

/** Matches a single `%X` time token or a `{name}` named token in one pass. */
const TOKEN_RE = /%(.)|\{([^}]*)\}/g

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/** The boot-time values a filename template resolves against (all supplied explicitly — pure). */
export interface LogPathContext {
  /** The service (instance) name — `{name}`. */
  name: string
  /** The process id — `{pid}`. */
  pid: number
  /** The configured listen port — `{port}`. */
  port: number
  /** The instant the strftime (`%…`) tokens render from. */
  now: Date
}

/**
 * The unknown tokens (`%Q`, `{bogus}`, …) in a filename template — empty when the
 * template uses only supported `%`-strftime / `{}`-named tokens. Pure; used both to
 * fail `decoy check` and as the resolver's safety net.
 */
export function unknownTemplateTokens(template: string): string[] {
  const unknown: string[] = []
  for (const match of template.matchAll(TOKEN_RE)) {
    const [full, timeChar, nameKey] = match
    if (timeChar !== undefined) {
      if (!(timeChar in TIME_TOKENS)) {
        unknown.push(full)
      }
    } else if (!NAME_TOKENS.includes(nameKey as (typeof NAME_TOKENS)[number])) {
      unknown.push(full)
    }
  }
  return unknown
}

/**
 * Resolve a request-log filename template against its boot context — once, at boot
 * (#70). `%Y %m %d %H %M %S %s` expand to UTC strftime fields; `{name} {pid} {port}`
 * to the named identifiers. Throws on an unknown token (validation catches these
 * earlier, so this is a guard, not the user-facing error path). Pure.
 */
export function resolveLogPath(template: string, ctx: LogPathContext): string {
  return template.replace(TOKEN_RE, (full, timeChar: string | undefined, nameKey: string) => {
    if (timeChar !== undefined) {
      const render = TIME_TOKENS[timeChar]
      if (!render) {
        throw new Error(`request-log path: unknown time token "${full}"`)
      }
      return render(ctx.now)
    }
    switch (nameKey) {
      case 'name':
        return ctx.name
      case 'pid':
        return String(ctx.pid)
      case 'port':
        return String(ctx.port)
      default:
        throw new Error(`request-log path: unknown token "${full}"`)
    }
  })
}

/**
 * Semantic validation of a service's `requestLog` block beyond its valibot shape,
 * reported service-scoped like the rest of the config: an **error** for
 * an unknown `path` filename token (fails `decoy check`), and a **warning** when a
 * `cleanup` mode is set for the in-memory store (a no-op there — cleanup is
 * sqlite-only) or when `on-session-end` is chosen (it deletes a session's logs on
 * destroy, disabling post-session retrieval). Defensive: a malformed block (caught
 * by the schema) yields no extra issues here.
 */
export function validateRequestLog(
  requestLog: unknown,
  file: string,
  service: string,
): ValidationIssue[] {
  if (requestLog === null || typeof requestLog !== 'object') {
    return []
  }
  const issues: ValidationIssue[] = []
  const config = requestLog as RequestLogConfig
  const store = config.store ?? 'memory'

  if (typeof config.path === 'string') {
    const unknown = unknownTemplateTokens(config.path)
    if (unknown.length > 0) {
      issues.push({
        severity: 'error',
        message: `error in ${service}: requestLog.path has unknown token(s): ${unknown.join(', ')}`,
        file,
      })
    }
  }

  if (config.cleanup !== undefined && store !== 'sqlite') {
    issues.push({
      severity: 'warning',
      message: `${service}: requestLog.cleanup "${config.cleanup}" is a no-op for the in-memory store (cleanup applies to store "sqlite" only)`,
      file,
    })
  } else if (store === 'sqlite' && config.cleanup === 'on-session-end') {
    issues.push({
      severity: 'warning',
      message: `${service}: requestLog.cleanup "on-session-end" deletes a session's logs on destroy — post-session log retrieval is disabled for this store`,
      file,
    })
  }

  return issues
}
