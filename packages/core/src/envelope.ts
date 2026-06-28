import type { RequestEnvelope } from './types'

/**
 * Normalize a raw header bag to a flat string map: `undefined` values are dropped
 * and array values (a repeated header) are joined with `, `. Node's `IncomingMessage`
 * headers and the framework adapters' header bags all fit this shape; an adapter
 * whose headers are already flat (e.g. Playwright) can skip this and pass them
 * straight to {@link buildEnvelope}.
 */
export function normalizeHeaders(
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

/** Parse a `Cookie` header value into a name→value map (values URI-decoded). */
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

/** Collapse `URLSearchParams` to a query object; a repeated key becomes an array. */
function queryToObject(params: URLSearchParams): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = {}
  for (const key of new Set(params.keys())) {
    const all = params.getAll(key)
    query[key] = all.length > 1 ? all : (all[0] ?? '')
  }
  return query
}

/**
 * Parse an already-read body **string** by content type: JSON when the type says so
 * (falling back to the raw text if it doesn't parse), otherwise the raw text;
 * `undefined` in stays `undefined` out. Adapters that take the host framework's
 * already-parsed `req.body` skip this and pass that value to {@link buildEnvelope}
 * directly; only adapters that source the body themselves (the server reads the raw
 * stream, Playwright reads `postData()`) call this.
 */
export function parseBody(raw: string | undefined, contentType: string): unknown {
  if (raw === undefined) {
    return undefined
  }
  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(raw)
    } catch {
      return raw
    }
  }
  return raw
}

/**
 * The raw transport facts an adapter supplies. Everything else in the envelope —
 * the path, the parsed query, the cookies — is **derived** here, so every transport
 * normalizes a request the same way and a request matches identically over HTTP and
 * in-process. The adapter owns only what is genuinely transport-specific: where the
 * URL comes from, how headers are shaped, and how the body is sourced.
 */
export interface EnvelopeInput {
  /** HTTP method, already defaulted (e.g. to `GET`) by the adapter if needed. */
  method: string
  /** The request URL as the transport reports it — relative or absolute. */
  url: string
  /** Flat header map (run a raw bag through {@link normalizeHeaders} first). */
  headers: Record<string, string>
  /** The resolved body: an already-parsed value, or the output of {@link parseBody}. */
  body: unknown
}

/**
 * Assemble the canonical {@link RequestEnvelope} from normalized transport facts.
 * The URL is parsed against a dummy base so a relative URL (`/users?x=1`) and an
 * absolute one (Playwright's full URL) both yield the same `path`/`query`; the base
 * is ignored when the URL is already absolute.
 */
export function buildEnvelope(input: EnvelopeInput): RequestEnvelope {
  const url = new URL(input.url, 'http://localhost')
  return {
    method: input.method,
    url: input.url,
    path: decodeURIComponent(url.pathname),
    params: {},
    query: queryToObject(url.searchParams),
    headers: input.headers,
    cookies: parseCookies(input.headers.cookie),
    body: input.body,
  }
}
