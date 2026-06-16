import type { MockResponse, Variant } from './types'

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const lower = name.toLowerCase()
  return Object.keys(headers).some((key) => key.toLowerCase() === lower)
}

/**
 * Resolve a (possibly `${ }`-templated) status to a number: a number passes
 * through, a numeric string is coerced, and anything non-numeric (or absent)
 * falls back to 200 — a misconfigured status never crashes the response.
 */
function resolveStatus(status: number | string | undefined): number {
  if (typeof status === 'number') {
    return status
  }
  if (typeof status === 'string') {
    const parsed = Number(status)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return 200
}

/** Coerce a (possibly templated) header value to a string; objects JSON-stringify. */
function headerString(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  if (value === null || value === undefined) {
    return ''
  }
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

/**
 * Turn a variant into a transport-agnostic response: default status 200, headers
 * coerced to strings and copied through, and `Content-Type` inferred for
 * object/array (JSON) and string (text) bodies unless the variant already sets
 * one. Status and header values may already be `${ }`-rendered (ADR-0009), so a
 * templated number status or non-string header value is coerced here.
 */
export function buildResponse(variant: Variant): MockResponse {
  const status = resolveStatus(variant.status)
  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(variant.headers ?? {})) {
    headers[name] = headerString(value)
  }
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
