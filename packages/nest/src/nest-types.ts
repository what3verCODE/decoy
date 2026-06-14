/**
 * The slice of NestJS's API this adapter touches. The DI + middleware-registration
 * types (`DynamicModule`, `MiddlewareConsumer`, `NestModule`, `ValueProvider`, and the
 * `forRoutes` target) are sourced from the real `@nestjs/common` via `import type` so
 * they can never drift from upstream. `@nestjs/common` is a **required peer dependency**;
 * `import type` keeps it type-level only, so the build emits no Nest import and the
 * package carries zero Nest runtime weight.
 *
 * The request/response the functional middleware receives are deliberately NOT sourced
 * from Nest: Nest is platform-agnostic and types them as `any` (they belong to the
 * underlying HTTP platform — Express by default). They are kept as the minimal
 * {@link NestRequest}/{@link NestResponse} envelope shapes, which also keep the
 * middleware unit-testable with plain fakes — no running Nest application. Nest's
 * default platform parses the body before middleware runs, so `req.body` is populated
 * for `body:` matching out of the box.
 */

import type {
  DynamicModule as NestDynamicModule,
  MiddlewareConsumer as NestMiddlewareConsumer,
  NestModule as NestModuleType,
  ValueProvider as NestValueProvider,
} from '@nestjs/common'

/** The subset of the platform request used to build the request envelope (an Express `Request` fits). */
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

/** The subset of the platform response the middleware writes a matched variant through. */
export interface NestResponse {
  statusCode: number
  setHeader(name: string, value: string): unknown
  end(chunk?: string): unknown
}

/** Nest's `next` callback: called with no argument to fall through, or an error to abort. */
export type NextFunction = (error?: unknown) => void

/** A Nest-compatible functional middleware signature. */
export type DecoyMiddlewareFn = (req: NestRequest, res: NestResponse, next: NextFunction) => void

/** Nest's `NestModule` lifecycle hook — `configure(consumer)` registers middleware. */
export type NestModule = NestModuleType

/** Nest's `MiddlewareConsumer` — `apply(...).forRoutes(...)` registers the middleware. */
export type MiddlewareConsumer = NestMiddlewareConsumer

/** The chaining proxy returned by `MiddlewareConsumer.apply` (Nest's own). */
export type MiddlewareConfigProxy = ReturnType<MiddlewareConsumer['apply']>

/** A route target accepted by `MiddlewareConsumer.forRoutes` — a path string, `Type`, or `RouteInfo`. */
export type RouteTarget = Parameters<MiddlewareConfigProxy['forRoutes']>[0]

/** A Nest value provider — binds an injection token to a ready value. */
export type ValueProvider = NestValueProvider

/** The subset of Nest's `DynamicModule` this adapter returns from `forRoot`/`forService`. */
export type DynamicModule = NestDynamicModule
