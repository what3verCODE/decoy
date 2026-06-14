/**
 * Structural subsets of the Express API the middleware touches. Typed
 * structurally (like {@link import('@decoy/playwright').PlaywrightRoute}) so this
 * package carries **no** Express runtime dependency: a real Express `Request`
 * satisfies {@link ExpressRequest}, a real `Response` satisfies
 * {@link ExpressResponse}, and `next` satisfies {@link NextFunction}. The
 * structural shapes also make the middleware unit-testable with plain fakes — no
 * running Express app.
 */

/** The subset of an Express `Request` used to build the request envelope. */
export interface ExpressRequest {
  method: string
  /** The original request URL (path + query), unaffected by router rewriting. */
  originalUrl?: string
  /** The (possibly router-rewritten) request URL; a fallback when `originalUrl` is absent. */
  url?: string
  headers: Record<string, string | string[] | undefined>
  /**
   * The parsed request body, if a body parser (e.g. `express.json()`) ran before
   * this middleware. `undefined` when none did — `body:` matchers then never match.
   */
  body?: unknown
}

/** The subset of an Express `Response` the middleware writes a matched variant through. */
export interface ExpressResponse {
  statusCode: number
  setHeader(name: string, value: string): unknown
  end(chunk?: string): unknown
}

/** Express's `next` callback: called with no argument to fall through, or an error to abort. */
export type NextFunction = (error?: unknown) => void

/** An Express-compatible request handler (middleware) signature. */
export type RequestHandler = (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => void
