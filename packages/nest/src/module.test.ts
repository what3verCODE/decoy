import type { Collection, Definitions, Route } from '@decoy/core'
import { describe, expect, test } from '@rstest/core'
import type { DecoyMiddleware } from './middleware'
import { DECOY_CONTROL, DECOY_MIDDLEWARE, DecoyModule } from './module'
import type {
  DynamicModule,
  MiddlewareConfigProxy,
  MiddlewareConsumer,
  NestModule,
  RouteTarget,
  ValueProvider,
} from './nest-types'

const usersRoute: Route = {
  id: 'users-by-id',
  method: 'GET',
  path: '/users/{id}',
  presets: { default: {} },
  variants: {
    ada: { status: 200, body: { id: 42, name: 'Ada' } },
    boom: { status: 500, body: { error: 'upstream exploded' } },
  },
}

const happyPath: Collection = { id: 'happy-path', routes: ['users-by-id:default:ada'] }
const errorState: Collection = { id: 'error-state', routes: ['users-by-id:default:boom'] }

function defs(): Definitions {
  return {
    routes: new Map([[usersRoute.id, usersRoute]]),
    collections: new Map([
      [happyPath.id, happyPath],
      [errorState.id, errorState],
    ]),
  }
}

/** Records what a Nest module registers through `consumer.apply(...).forRoutes(...)`. */
function fakeConsumer() {
  const applied: unknown[] = []
  let forRoutesArgs: RouteTarget[] = []
  const consumer: MiddlewareConsumer = {
    apply(...middleware: unknown[]) {
      applied.push(...middleware)
      const proxy: MiddlewareConfigProxy = {
        forRoutes(...routes) {
          forRoutesArgs = routes as RouteTarget[]
          return consumer
        },
        // The adapter never calls exclude(); a chaining no-op satisfies the real proxy.
        exclude() {
          return proxy
        },
      }
      return proxy
    },
  }
  return {
    consumer,
    get applied() {
      return applied
    },
    get forRoutesArgs() {
      return forRoutesArgs
    },
  }
}

/** Instantiate the dynamic module's class and run its `configure` against a fake consumer. */
function runConfigure(dynamic: DynamicModule) {
  const ModuleClass = dynamic.module as new () => NestModule
  const instance = new ModuleClass()
  const rec = fakeConsumer()
  instance.configure(rec.consumer)
  return rec
}

function providerValue(dynamic: DynamicModule, token: unknown): unknown {
  const providers = (dynamic.providers ?? []) as ValueProvider[]
  return providers.find((p) => p.provide === token)?.useValue
}

describe('DecoyModule.forRoot', () => {
  test('provides and exports the control API + middleware tokens', () => {
    const dynamic = DecoyModule.forRoot({ definitions: defs(), defaultCollection: 'happy-path' })

    const middleware = providerValue(dynamic, DECOY_MIDDLEWARE) as DecoyMiddleware
    const control = providerValue(dynamic, DECOY_CONTROL)
    expect(middleware.selection.collection).toBe('happy-path')
    expect(control).toBe(middleware.control)
    expect(dynamic.exports).toEqual([DECOY_MIDDLEWARE, DECOY_CONTROL])
  })

  test('configure() applies the middleware on all routes by default', () => {
    const dynamic = DecoyModule.forRoot({ definitions: defs(), defaultCollection: 'happy-path' })
    const middleware = providerValue(dynamic, DECOY_MIDDLEWARE)

    const rec = runConfigure(dynamic)
    expect(rec.applied).toEqual([middleware])
    expect(rec.forRoutesArgs).toEqual(['*'])
  })

  test('configure() honours an explicit routes scope', () => {
    const dynamic = DecoyModule.forRoot({
      definitions: defs(),
      defaultCollection: 'happy-path',
      routes: ['/users', { path: '/orders', method: 0 }],
    })

    const rec = runConfigure(dynamic)
    expect(rec.forRoutesArgs).toEqual(['/users', { path: '/orders', method: 0 }])
  })

  test('the provided middleware serves a matched variant and is driven by control', () => {
    const dynamic = DecoyModule.forRoot({ definitions: defs(), defaultCollection: 'happy-path' })
    const middleware = providerValue(dynamic, DECOY_MIDDLEWARE) as DecoyMiddleware

    middleware.control.useCollection('error-state')
    expect(middleware.selection.collection).toBe('error-state')
  })

  test('two modules embed independent engines (one instance per upstream)', () => {
    const a = DecoyModule.forRoot({ definitions: defs(), defaultCollection: 'happy-path' })
    const b = DecoyModule.forRoot({ definitions: defs(), defaultCollection: 'error-state' })

    expect(a.module).not.toBe(b.module)
    const aMw = providerValue(a, DECOY_MIDDLEWARE) as DecoyMiddleware
    const bMw = providerValue(b, DECOY_MIDDLEWARE) as DecoyMiddleware
    aMw.control.useCollection('error-state')
    expect(aMw.selection.collection).toBe('error-state')
    expect(bMw.selection.collection).toBe('error-state')
    bMw.control.useCollection('happy-path')
    expect(bMw.selection.collection).toBe('happy-path')
    expect(aMw.selection.collection).toBe('error-state')
  })

  test('an unknown default collection throws at module construction', () => {
    expect(() => DecoyModule.forRoot({ definitions: defs(), defaultCollection: 'nope' })).toThrow(
      /collection "nope" is not defined/,
    )
  })
})

describe('DecoyModule.forService', () => {
  test('builds a module from a LoadedService, embedding its definitions', () => {
    const dynamic = DecoyModule.forService({
      name: 'api',
      port: 4000,
      defaultCollection: 'happy-path',
      missStatus: 501,
      sessionIdleTtlMs: 0,
      definitions: defs(),
      control: { enabled: false, prefix: '/__decoy__' },
    })

    const middleware = providerValue(dynamic, DECOY_MIDDLEWARE) as DecoyMiddleware
    expect(middleware.selection.collection).toBe('happy-path')
    expect(runConfigure(dynamic).forRoutesArgs).toEqual(['*'])
  })
})
