/**
 * The slice of Fastify's API the plugin touches, sourced from the real `fastify`
 * types via `import type` so they can never drift from upstream. `fastify` is a
 * **required peer dependency**; `import type` keeps it type-level only, so the build
 * emits no Fastify import and the package carries zero Fastify runtime weight. The
 * `Pick`-narrowed shapes also keep the plugin unit-testable with plain fakes — no
 * running Fastify app.
 */

import type { FastifyInstance, FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify'

/**
 * The subset of a Fastify `Request` used to build the request envelope. `url` is the
 * raw path+query Fastify received; `body` is whatever Fastify's content-type parser
 * produced (JSON out of the box for `application/json`, unlike Express which needs a
 * body parser registered), so `body:` matchers work without extra wiring.
 */
export type FastifyMockRequest = Pick<FastifyRequest, 'method' | 'url' | 'headers' | 'body'>

/** The subset of a Fastify `Reply` the plugin writes a matched (or fail-closed) response through. */
export type FastifyMockReply = Pick<FastifyReply, 'code' | 'header' | 'send'>

/** The Fastify instance surface the plugin registers its hook and not-found handler on. */
export type FastifyMockInstance = Pick<FastifyInstance, 'addHook' | 'setNotFoundHandler'>

/** A Fastify plugin registered via `fastify.register(...)`. */
export type { FastifyPluginCallback }
