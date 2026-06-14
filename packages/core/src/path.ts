/** A route path compiled to a matcher over request paths. */
export interface CompiledPath {
  regex: RegExp
  keys: string[]
}

const PARAM = /^\{([^}]+)\}$/

function escapeSegment(segment: string): string {
  return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Compile an OpenAPI-style path (`/users/{id}`) into a regex plus the ordered
 * names of its path parameters. Matching is exact (anchored), segment by segment.
 */
export function compilePath(routePath: string): CompiledPath {
  const keys: string[] = []
  const segments = routePath.split('/').filter((s) => s.length > 0)

  let pattern = ''
  for (const segment of segments) {
    const param = PARAM.exec(segment)
    if (param?.[1]) {
      keys.push(param[1])
      pattern += '/([^/]+)'
    } else {
      pattern += `/${escapeSegment(segment)}`
    }
  }
  if (pattern === '') {
    pattern = '/'
  }

  return { regex: new RegExp(`^${pattern}/?$`), keys }
}

/**
 * Match a request path against a compiled path, returning the extracted path
 * params, or `null` if it does not match.
 */
export function matchPath(
  compiled: CompiledPath,
  requestPath: string,
): Record<string, string> | null {
  const result = compiled.regex.exec(requestPath)
  if (!result) {
    return null
  }

  const params: Record<string, string> = {}
  for (let i = 0; i < compiled.keys.length; i++) {
    const key = compiled.keys[i]
    const value = result[i + 1]
    if (key !== undefined && value !== undefined) {
      params[key] = decodeURIComponent(value)
    }
  }
  return params
}
