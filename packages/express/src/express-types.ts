/**
 * The slice of Express's API the middleware touches, sourced from the real `express`
 * types via `import type` so they can never drift from upstream (the previous
 * hand-rolled `setHeader`, for instance, ignored Express's real overloads). `express`
 * is a **required peer dependency**; `import type` keeps it type-level only, so the
 * build emits no Express import and the package carries zero Express runtime weight.
 * The `Pick`-narrowed shapes also keep the middleware unit-testable with plain fakes —
 * no running Express app.
 */

import type {
  NextFunction as ExpressNextFunction,
  RequestHandler as ExpressRequestHandler,
  Request,
  Response,
} from 'express'

/**
 * The subset of an Express `Request` used to build the request envelope. `originalUrl`
 * and `url` are kept optional: the adapter falls back across them (and `req.body` is
 * `undefined` until a body parser runs), so a fake need only set what a case exercises.
 */
export type ExpressRequest = Pick<Request, 'method' | 'headers' | 'body'> &
  Partial<Pick<Request, 'originalUrl' | 'url'>>

/** The subset of an Express `Response` the middleware writes a matched variant through. */
export type ExpressResponse = Pick<Response, 'statusCode' | 'setHeader' | 'end'>

/** Express's `next` callback: called with no argument to fall through, or an error to abort. */
export type NextFunction = ExpressNextFunction

/** An Express-compatible request handler (middleware) signature. */
export type RequestHandler = ExpressRequestHandler
