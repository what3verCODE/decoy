export { toEnvelope } from './envelope'
export {
  createDecoyMiddleware,
  type DecoyMiddleware,
  type DecoyMiddlewareOptions,
  fromService,
} from './middleware'
export {
  DECOY_CONTROL,
  DECOY_MIDDLEWARE,
  DecoyModule,
  type DecoyModuleOptions,
} from './module'
export type {
  DecoyMiddlewareFn,
  DynamicModule,
  MiddlewareConfigProxy,
  MiddlewareConsumer,
  NestModule,
  NestRequest,
  NestResponse,
  NextFunction,
  RouteTarget,
  ValueProvider,
} from './nest-types'
