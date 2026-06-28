import { buildEnvelope, normalizeHeaders, type RequestEnvelope } from '@decoy/core'
import type { FastifyMockRequest } from './fastify-types'

/**
 * Build the documented request envelope from a Fastify `Request`. The shared core
 * normalizer derives path/query/cookies, so a request matches the same way whether
 * it reaches the engine over HTTP or in-process.
 *
 * Unlike the server — which reads and JSON-parses the raw body itself — this adapter
 * takes the **already-parsed** `request.body`: Fastify runs its content-type parser
 * before the engine, so `application/json` requests already carry a parsed `body`
 * here with no extra setup. A body Fastify left unparsed (`undefined`) simply never
 * matches a `body:` matcher.
 */
export function toEnvelope(request: FastifyMockRequest): RequestEnvelope {
  return buildEnvelope({
    method: request.method,
    url: request.url || '/',
    headers: normalizeHeaders(request.headers),
    body: request.body,
  })
}
