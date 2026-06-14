import type { RequestEnvelope } from '@decoy/core'
import type { FastifyMockRequest } from './fastify-types'

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
 * Build the documented request envelope (CONTEXT.md, ADR-0009) from a Fastify
 * `Request`. Semantics mirror the server's `envelopeFrom` so a request matches the
 * same way whether it reaches the engine over HTTP or in-process: path/query split
 * from the URL (repeated keys become arrays), headers normalized (array values
 * joined), and cookies parsed from the `Cookie` header.
 *
 * Unlike the server — which reads and JSON-parses the raw body itself — this adapter
 * takes the **already-parsed** `request.body`: Fastify runs its content-type parser
 * before the engine, so `application/json` requests already carry a parsed `body`
 * here with no extra setup. A body Fastify left unparsed (`undefined`) simply never
 * matches a `body:` matcher.
 */
export function toEnvelope(request: FastifyMockRequest): RequestEnvelope {
  const rawUrl = request.url || '/'
  const url = new URL(rawUrl, 'http://localhost')
  const headers = normalizeHeaders(request.headers)

  return {
    method: request.method,
    url: rawUrl,
    path: decodeURIComponent(url.pathname),
    pathParams: {},
    query: queryToObject(url.searchParams),
    headers,
    cookies: parseCookies(headers.cookie),
    body: request.body,
  }
}
