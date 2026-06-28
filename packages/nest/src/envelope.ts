import { buildEnvelope, normalizeHeaders, type RequestEnvelope } from '@decoy/core'
import type { NestRequest } from './nest-types'

/**
 * Build the documented request envelope from a Nest request. The shared core
 * normalizer derives path/query/cookies, so a request matches the same way whether
 * it reaches the engine over HTTP or in-process through a Nest module.
 *
 * The already-parsed `req.body` is taken verbatim rather than reading the request
 * stream — consuming it here would starve the host app's own handlers on fallthrough.
 * Nest's default platform parses the body before middleware runs, so `req.body` is
 * populated for `body:` matching out of the box.
 */
export function toEnvelope(req: NestRequest): RequestEnvelope {
  return buildEnvelope({
    method: req.method,
    url: req.originalUrl ?? req.url ?? '/',
    headers: normalizeHeaders(req.headers),
    body: req.body,
  })
}
