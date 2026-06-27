import type { RequestEnvelope } from '@decoy/core'
import type { ExpressRequest } from './express-types'

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
 * Build the documented request envelope from an Express
 * `Request`. Semantics mirror the server's `envelopeFrom` so a request matches the
 * same way whether it reaches the engine over HTTP or in-process: path/query split
 * from the URL (repeated keys become arrays), headers normalized (array values
 * joined), and cookies parsed from the `Cookie` header.
 *
 * Unlike the server — which reads and JSON-parses the raw body itself — this
 * adapter takes the **already-parsed** `req.body`: consuming the request stream
 * here would starve the host app's own handlers on fallthrough. Mount a body
 * parser (e.g. `express.json()`) before the decoy middleware for `body:` matching;
 * absent one, `req.body` is `undefined` and body matchers simply never match.
 */
export function toEnvelope(req: ExpressRequest): RequestEnvelope {
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
