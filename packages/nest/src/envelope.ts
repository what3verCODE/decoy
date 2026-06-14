import type { RequestEnvelope } from '@decoy/core'
import type { NestRequest } from './nest-types'

function normalizeHeaders(
  raw: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) {
      continue
    }
    headers[key] = Array.isArray(value) ? value.join(', ') : value
  }
  return headers
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {}
  if (!cookieHeader) {
    return cookies
  }
  for (const pair of cookieHeader.split(';')) {
    const index = pair.indexOf('=')
    if (index === -1) {
      continue
    }
    const name = pair.slice(0, index).trim()
    if (name) {
      cookies[name] = decodeURIComponent(pair.slice(index + 1).trim())
    }
  }
  return cookies
}

function queryToObject(params: URLSearchParams): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = {}
  for (const key of new Set(params.keys())) {
    const all = params.getAll(key)
    query[key] = all.length > 1 ? all : (all[0] ?? '')
  }
  return query
}

/**
 * Build the documented request envelope (CONTEXT.md, ADR-0009) from a Nest request.
 * Semantics mirror the server's `envelopeFrom` (and the Express adapter's
 * `toEnvelope`) so a request matches the same way whether it reaches the engine over
 * HTTP or in-process through a Nest module: path/query split from the URL (repeated
 * keys become arrays), headers normalized (array values joined), and cookies parsed
 * from the `Cookie` header.
 *
 * The already-parsed `req.body` is taken verbatim rather than reading the request
 * stream — consuming it here would starve the host app's own handlers on fallthrough.
 * Nest's default platform parses the body before middleware runs, so `req.body` is
 * populated for `body:` matching out of the box.
 */
export function toEnvelope(req: NestRequest): RequestEnvelope {
  const rawUrl = req.originalUrl ?? req.url ?? '/'
  const url = new URL(rawUrl, 'http://localhost')
  const headers = normalizeHeaders(req.headers)

  return {
    method: req.method,
    url: rawUrl,
    path: decodeURIComponent(url.pathname),
    pathParams: {},
    query: queryToObject(url.searchParams),
    headers,
    cookies: parseCookies(headers.cookie),
    body: req.body,
  }
}
