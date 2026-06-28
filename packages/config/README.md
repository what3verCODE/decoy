# @decoy/config

Load and validate the config and mock files into a `LoadedService` the engine can run.

**Role** · the authoring surface — `defineConfig` and the loaders for `.ts`/`.js`/`.yaml`/`.json`
configs, `routesDir` + `collectionsFile` resolution, and valibot-backed validation.
**Exports** · `defineConfig`, `loadConfig`/`loadConfigs`, `validateConfig`, `parseDataFile`, and the
config types (`ServiceConfig`, `DecoyConfig`, `LoadedService`, `ControlConfig`, …).
**Depends on** · `@decoy/core`.
**Used by** · `@decoy/server`, `@decoy/cli`, and every adapter (`express`/`fastify`/`nest`/`playwright`).

Options reference → `/reference/configuration`. Generated API → `/reference/api/`.
