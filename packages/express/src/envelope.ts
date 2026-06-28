import { buildEnvelope, normalizeHeaders, type RequestEnvelope } from '@decoy/core'
import type { ExpressRequest } from './express-types'

/**
 * Build the documented request envelope from an Express `Request`. The shared core
 * normalizer derives path/query/cookies, so a request matches the same way whether
 * it reaches the engine over HTTP or in-process.
 *
 * Unlike the server — which reads and JSON-parses the raw body itself — this
 * adapter takes the **already-parsed** `req.body`: consuming the request stream
 * here would starve the host app's own handlers on fallthrough. Mount a body
 * parser (e.g. `express.json()`) before the decoy middleware for `body:` matching;
 * absent one, `req.body` is `undefined` and body matchers simply never match.
 */
export function toEnvelope(req: ExpressRequest): RequestEnvelope {
  return buildEnvelope({
    method: req.method,
    url: req.originalUrl ?? req.url ?? '/',
    headers: normalizeHeaders(req.headers),
    body: req.body,
  })
}
