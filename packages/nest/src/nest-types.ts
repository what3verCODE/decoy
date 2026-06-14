/**
 * Structural subsets of the NestJS API this adapter touches. Typed structurally
 * (like {@link import('@decoy/express').ExpressRequest} and
 * {@link import('@decoy/playwright').PlaywrightRoute}) so the package carries **no**
 * `@nestjs/common` runtime dependency: a real Nest request/response satisfies
 * {@link NestRequest}/{@link NestResponse}, a real `MiddlewareConsumer` satisfies
 * {@link MiddlewareConsumer}, and a `DynamicModule` returned by
 * {@link import('./module').DecoyModule} fits Nest's own `DynamicModule`. The
 * structural shapes also make the module + middleware unit-testable with plain fakes
 * — no running Nest application.
 *
 * Nest's default (Express) platform parses the body before middleware runs, so
 * `req.body` is populated out of the box — unlike the bare Express adapter, `body:`
 * matching needs no extra wiring here.
 */

/** The subset of a Nest request used to build the request envelope (an Express `Request` fits). */
export interface NestRequest {
  method: string
  /** The original request URL (path + query), unaffected by router rewriting. */
  originalUrl?: string
  /** The (possibly router-rewritten) request URL; a fallback when `originalUrl` is absent. */
  url?: string
  headers: Record<string, string | string[] | undefined>
  /** The parsed request body; populated by Nest's default body parser. */
  body?: unknown
}

/** The subset of a Nest response the middleware writes a matched variant through. */
export interface NestResponse {
  statusCode: number
  setHeader(name: string, value: string): unknown
  end(chunk?: string): unknown
}

/** Nest's `next` callback: called with no argument to fall through, or an error to abort. */
export type NextFunction = (error?: unknown) => void

/** A Nest-compatible functional middleware signature. */
export type DecoyMiddlewareFn = (req: NestRequest, res: NestResponse, next: NextFunction) => void

/** A route target accepted by `MiddlewareConsumer.forRoutes` — a path string or `{ path, method }`. */
export type RouteTarget = string | { path: string; method?: number }

/** The chaining proxy returned by `MiddlewareConsumer.apply`. */
export interface MiddlewareConfigProxy {
  forRoutes(...routes: RouteTarget[]): MiddlewareConsumer
}

/** The subset of Nest's `MiddlewareConsumer` used to register the middleware. */
export interface MiddlewareConsumer {
  apply(...middleware: unknown[]): MiddlewareConfigProxy
}

/** The `NestModule` lifecycle hook Nest calls to let a module register middleware. */
export interface NestModule {
  configure(consumer: MiddlewareConsumer): void
}

/** A Nest value provider — binds an injection token to a ready value. */
export interface ValueProvider {
  provide: unknown
  useValue: unknown
}

/** The subset of Nest's `DynamicModule` this adapter returns from `forRoot`/`forService`. */
export interface DynamicModule {
  module: unknown
  providers?: ValueProvider[]
  exports?: unknown[]
  global?: boolean
}
