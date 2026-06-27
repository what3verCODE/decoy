import type { RequestEnvelope } from '@decoy/core'
import type { PlaywrightRequest } from './playwright-types'

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

function parseBody(postData: string | null, contentType: string | undefined): unknown {
  if (postData === null) {
    return undefined
  }
  if ((contentType ?? '').includes('application/json')) {
    try {
      return JSON.parse(postData)
    } catch {
      return postData
    }
  }
  return postData
}

/**
 * Build the documented request envelope from a Playwright
 * `Request`. Semantics mirror the server's `toEnvelope` so a request matches the
 * same way whether it reaches the engine over HTTP or through `page.route`:
 * path/query split from the URL (repeated keys become arrays), cookies parsed
 * from the `Cookie` header, and a JSON `postData` parsed when the content type
 * says so (any non-JSON body kept raw; no body → `undefined`).
 */
export function toEnvelope(request: PlaywrightRequest): RequestEnvelope {
  const rawUrl = request.url()
  const url = new URL(rawUrl)
  const headers = request.headers()

  return {
    method: request.method(),
    url: rawUrl,
    path: decodeURIComponent(url.pathname),
    pathParams: {},
    query: queryToObject(url.searchParams),
    headers,
    cookies: parseCookies(headers.cookie),
    body: parseBody(request.postData(), headers['content-type']),
  }
}
