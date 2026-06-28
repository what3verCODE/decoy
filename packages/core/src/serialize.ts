import type { MatchResult, MockResponse } from './types'

/**
 * A transport-neutral, fully-serialized response: a status, the finalized headers,
 * and the body **bytes** as a string (or `undefined` for no payload). Every
 * transport produces one of these from a {@link MatchResult} and only has to write
 * it — so the bytes a mock serves are identical over HTTP, in-process, and through
 * `page.route`.
 */
export interface ResponsePlan {
  status: number
  headers: Record<string, string>
  /** The serialized body to write, or `undefined` to send no payload. */
  body: string | undefined
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const lower = name.toLowerCase()
  return Object.keys(headers).some((key) => key.toLowerCase() === lower)
}

/**
 * Serialize a matched {@link MockResponse} into a {@link ResponsePlan}: a string body
 * passes through; an object/array body is `JSON.stringify`d with
 * `content-type: application/json` inferred unless the variant already set one; a
 * `null`/`undefined` body sends no payload. The input's headers are copied, never
 * mutated.
 */
export function planMatched(response: MockResponse): ResponsePlan {
  const headers = { ...response.headers }
  const body = response.body

  if (body === undefined || body === null) {
    return { status: response.status, headers, body: undefined }
  }
  if (typeof body === 'string') {
    return { status: response.status, headers, body }
  }
  if (!hasHeader(headers, 'content-type')) {
    headers['content-type'] = 'application/json'
  }
  return { status: response.status, headers, body: JSON.stringify(body) }
}

/**
 * Serialize a fail-closed miss into a {@link ResponsePlan}: the configured
 * `missStatus`, an `x-mock-miss: true` header an app/test can hard-assert, and a JSON
 * `{ error }` diagnostic body — so an unmatched request fails loudly instead of
 * leaking to a real backend.
 */
export function planMiss(message: string, missStatus: number): ResponsePlan {
  return {
    status: missStatus,
    headers: { 'x-mock-miss': 'true', 'content-type': 'application/json' },
    body: JSON.stringify({ error: message }),
  }
}

/**
 * Turn a {@link MatchResult} into a transport-neutral {@link ResponsePlan}: a match
 * serializes its variant, a miss fails closed with `missStatus`. Adapters that handle
 * a miss differently (e.g. middleware that falls through to the host app) call
 * {@link planMatched}/{@link planMiss} directly instead.
 */
export function planResponse(result: MatchResult, missStatus: number): ResponsePlan {
  return result.type === 'matched'
    ? planMatched(result.response)
    : planMiss(result.message, missStatus)
}
