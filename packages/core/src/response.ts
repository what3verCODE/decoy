import type { MockResponse, Variant } from './types'

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const lower = name.toLowerCase()
  return Object.keys(headers).some((key) => key.toLowerCase() === lower)
}

/**
 * Turn a variant into a transport-agnostic response: default status 200, headers
 * copied through, and `Content-Type` inferred for object/array (JSON) and string
 * (text) bodies unless the variant already sets one.
 */
export function buildResponse(variant: Variant): MockResponse {
  const status = variant.status ?? 200
  const headers: Record<string, string> = { ...variant.headers }
  const body = variant.body

  if (body !== undefined && body !== null && !hasHeader(headers, 'content-type')) {
    if (typeof body === 'object') {
      headers['content-type'] = 'application/json'
    } else if (typeof body === 'string') {
      headers['content-type'] = 'text/plain; charset=utf-8'
    }
  }

  return { status, headers, body }
}
