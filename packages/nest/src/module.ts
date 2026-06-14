import type { LoadedService } from '@decoy/config'
import {
  createDecoyMiddleware,
  type DecoyMiddleware,
  type DecoyMiddlewareOptions,
} from './middleware'
import type { DynamicModule, MiddlewareConsumer, NestModule, RouteTarget } from './nest-types'

/**
 * Injection token for the embedded {@link import('@decoy/core').Controller} — the
 * canonical JS control API. Inject it into a Nest provider/controller (e.g. a test
 * helper) to drive scenarios in-process: `setCollection`/`useRoute`/`reset`.
 *
 * @example
 *   constructor(@Inject(DECOY_CONTROL) private readonly control: Controller) {}
 */
export const DECOY_CONTROL = Symbol('decoy:control')

/** Injection token for the {@link DecoyMiddleware} itself (control + selection attached). */
export const DECOY_MIDDLEWARE = Symbol('decoy:middleware')

/** Options for {@link DecoyModule.forRoot}. */
export interface DecoyModuleOptions extends DecoyMiddlewareOptions {
  /**
   * Routes the middleware intercepts, in `MiddlewareConsumer.forRoutes` form.
   * Defaults to all routes (`'*'`) — matched ones are served from mocks, the rest
   * fall through to the host app's controllers.
   */
  routes?: RouteTarget[]
}

function buildModule(middleware: DecoyMiddleware, routes: RouteTarget[]): DynamicModule {
  // A per-call subclass closes over this middleware + routes, so its `configure` hook
  // registers exactly this instance — multiple `forRoot`/`forService` modules stay
  // independent (one instance per impersonated upstream, ADR-0006) with no shared
  // mutable state. Nest merges the dynamic providers/exports below onto the class.
  class DecoyModuleInstance extends DecoyModule {
    override configure(consumer: MiddlewareConsumer): void {
      consumer.apply(middleware).forRoutes(...routes)
    }
  }

  return {
    module: DecoyModuleInstance,
    providers: [
      { provide: DECOY_MIDDLEWARE, useValue: middleware },
      { provide: DECOY_CONTROL, useValue: middleware.control },
    ],
    exports: [DECOY_MIDDLEWARE, DECOY_CONTROL],
  }
}

/**
 * A NestJS module that embeds the in-process engine for partial mocking — the
 * idiomatic, in-process alternative to running the standalone `@decoy/server`.
 * Matched routes are served from their mock variants; unmatched requests fall through
 * to the host app's own controllers (no fail-closed 501). The embedded control API is
 * provided + exported under {@link DECOY_CONTROL} so other Nest providers can drive
 * scenarios in-process.
 *
 * @example
 *   imports: [DecoyModule.fromService(service)]
 *   // matched routes mocked, everything else hits your real controllers
 */
export class DecoyModule implements NestModule {
  /** No-op default; each `forRoot`/`forService` returns a subclass that registers its own middleware. */
  configure(_consumer: MiddlewareConsumer): void {}

  /**
   * Build a {@link DynamicModule} over the given definitions, starting on
   * `defaultCollection`. The module embeds a fresh middleware (its own
   * {@link import('@decoy/core').Controller}), auto-applies it on `options.routes`
   * (default all routes), and exports {@link DECOY_CONTROL}/{@link DECOY_MIDDLEWARE}.
   * Throws if `defaultCollection` is not defined.
   */
  static forRoot(options: DecoyModuleOptions): DynamicModule {
    const middleware = createDecoyMiddleware({
      definitions: options.definitions,
      defaultCollection: options.defaultCollection,
    })
    return buildModule(middleware, options.routes ?? ['*'])
  }

  /**
   * Build a {@link DynamicModule} directly from a `@decoy/config`
   * {@link LoadedService} — the same resolved artifact the standalone server boots
   * from — embedding its definitions and starting on its `defaultCollection`.
   * Intercepts all routes; pass `routes` to scope it.
   */
  static forService(service: LoadedService, routes?: RouteTarget[]): DynamicModule {
    return DecoyModule.forRoot({
      definitions: service.definitions,
      defaultCollection: service.defaultCollection,
      routes,
    })
  }
}
