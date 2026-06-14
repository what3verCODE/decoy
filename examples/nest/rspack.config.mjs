import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

// Build the `dev` entry into a single runnable Node bundle (Rspack — the repo's
// bundler, also under rslib/rstest/Rsbuild). See https://rspack.rs/guide/tech/nestjs.
//
// Why bundle at all: in-workspace the `@decoy/*` packages export TypeScript SOURCE
// with extensionless, bundler-style imports that plain Node can't resolve. Rspack's
// swc-loader transpiles those sources (and the Nest decorators in this example) and
// resolves their imports — so the emitted `dist/main.cjs` runs on plain `node`.
//
// What stays EXTERNAL (required from node_modules at runtime, where each resolves its
// own deps): the framework peers — @nestjs/* must be a single instance for its DI
// metadata, and reflect-metadata must be one global Reflect — plus `jiti`, which
// @decoy/config uses at runtime to load this example's TS config + mock files. jiti
// is a TS loader that resolves/transpiles on the fly (it drags in `typescript` and
// uses dynamic requires); bundling it bloats the output and breaks those requires, so
// it runs from its own install. `typescript` is external for the same reason — it is
// only referenced by cosmiconfig's default TS loader, which @decoy/config overrides
// with jiti, so it is a dead path here; leaving it external keeps the megabytes of
// compiler out of the bundle. Everything else (@decoy/* and their pure deps:
// cosmiconfig, valibot, yaml, jmespath) is bundled, so the output is self-contained
// apart from those externals.
const EXTERNAL = [/^@nestjs\//, 'reflect-metadata', 'rxjs', 'jiti', 'typescript']
const isExternal = (request) =>
  EXTERNAL.some((entry) => (typeof entry === 'string' ? entry === request : entry.test(request)))

export default {
  target: 'node',
  mode: 'development',
  devtool: false,
  context: here,
  entry: './dev.ts',
  output: {
    path: resolve(here, 'dist'),
    filename: 'main.cjs',
    clean: true,
  },
  resolve: {
    extensions: ['...', '.ts'],
  },
  externalsType: 'commonjs',
  externals: [
    ({ request }, callback) =>
      request && isExternal(request) ? callback(null, `commonjs ${request}`) : callback(),
  ],
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: {
          loader: 'builtin:swc-loader',
          options: {
            jsc: {
              parser: { syntax: 'typescript', decorators: true },
              // Nest's @Module/@Controller/@Get are TS legacy decorators that rely
              // on emitted parameter metadata (mirrors packages/nest's rstest config).
              transform: { legacyDecorator: true, decoratorMetadata: true },
            },
          },
        },
      },
    ],
  },
}
