import { buildEnvelope, parseBody, type RequestEnvelope } from '@decoy/core'
import type { PlaywrightRequest } from './playwright-types'

/**
 * Build the documented request envelope from a Playwright `Request`. The shared core
 * normalizer derives path/query/cookies, so a request matches the same way whether
 * it reaches the engine over HTTP or through `page.route`.
 *
 * Playwright's `headers()` is already a flat map, so it needs no header
 * normalization. The body is sourced from `postData()` and JSON-parsed by content
 * type (any non-JSON body kept raw; no body → `undefined`).
 */
export function toEnvelope(request: PlaywrightRequest): RequestEnvelope {
  const headers = request.headers()
  return buildEnvelope({
    method: request.method(),
    url: request.url(),
    headers,
    body: parseBody(request.postData() ?? undefined, headers['content-type'] ?? ''),
  })
}
