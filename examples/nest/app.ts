// reflect-metadata must load before any @nestjs decorator runs (Nest reads class
// metadata through it). The decorators below execute when buildApp() is called.
import 'reflect-metadata'
import type { LoadedService } from '@decoy/config'
import type { Controller as ControlApi } from '@decoy/core'
import { DECOY_CONTROL, DecoyModule } from '@decoy/nest'
import { Controller, Get, type INestApplication, Module } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'

/** A real NestJS app with Decoy embedded as an in-process module. */
export interface DecoyApp {
  /** The Nest application, ready to `listen()`. */
  app: INestApplication
  /**
   * The embedded engine's in-process control handle (`setCollection`/`useRoute`/
   * `reset`), resolved from the container under {@link DECOY_CONTROL}. Because the
   * mock runs inside this process, scenarios are switched by calling this directly —
   * no standalone server, no `/admin`.
   */
  control: ControlApi
}

/**
 * Build the example app from a loaded service. Decoy is wired as a module via
 * {@link DecoyModule.forService}: a request that matches a mocked route is served
 * from its variant; a miss falls through to the app's own controllers — so
 * `/users/{id}` is faked while the real `/health` controller still answers. "Start
 * the client + the mock" collapses to starting this one app, because the mock lives
 * in-process. The embedded control API is exported under {@link DECOY_CONTROL}, so
 * here it is resolved straight from the live Nest container.
 */
export async function buildApp(service: LoadedService): Promise<DecoyApp> {
  // A real downstream controller in the SAME app — reached only when Decoy misses
  // and falls through (the embedded module never fails closed with a 501). This is
  // the host app's own route, never mocked.
  @Controller()
  class HostController {
    @Get('health')
    health() {
      return { status: 'ok', from: 'host app' }
    }
  }

  @Module({
    imports: [DecoyModule.forService(service)],
    controllers: [HostController],
  })
  class AppModule {}

  const app = await NestFactory.create(AppModule, { logger: false })
  // strict:false searches the imported DecoyModule's exports for the control token.
  const control = app.get<ControlApi>(DECOY_CONTROL, { strict: false })

  return { app, control }
}
