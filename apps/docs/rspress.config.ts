import { join } from 'node:path'
import { defineConfig } from '@rspress/core'
import { pluginLlms } from '@rspress/plugin-llms'
import { pluginTypeDoc } from '@rspress/plugin-typedoc'

// TypeDoc generates the API reference from each package's JSDoc — every exported
// symbol, always in sync with source. Output lands under the Reference section
// (served at /reference/api/); the .md is gitignored and regenerated on each build,
// so there is no hand-maintained second copy to drift. One entry per public
// package's surface (`src/index.ts`). @decoy/ui is static assets, not a typed API;
// @decoy/testplane has no published surface yet (its example lands with #43) — both
// omitted.
const apiEntryPoints = [
  'core',
  'config',
  'control',
  'server',
  'cli',
  'playwright',
  'express',
  'fastify',
  'nest',
].map((pkg) => join(import.meta.dirname, '..', '..', 'packages', pkg, 'src', 'index.ts'))

// Host-agnostic static output: the deploy target is deferred, so `base` is
// configurable via DOCS_BASE (e.g. '/decoy/' for a sub-path host) and defaults
// to '/'. The site is fully decoupled from @decoy/server.
export default defineConfig({
  root: 'docs',
  base: process.env.DOCS_BASE ?? '/',
  outDir: 'dist',
  title: 'Decoy',
  description: 'A fast, contract-first HTTP mock you point a base URL at.',
  lang: 'en',
  locales: [
    {
      lang: 'en',
      label: 'English',
      title: 'Decoy',
      description: 'A fast, contract-first HTTP mock you point a base URL at.',
    },
    {
      lang: 'ru',
      label: 'Русский',
      title: 'Decoy',
      description: 'Быстрый HTTP-мок: указываете базовый URL — и готово.',
    },
  ],
  plugins: [
    pluginLlms(),
    pluginTypeDoc({
      entryPoints: apiEntryPoints,
      // Resolves under the docs root; lands the generated API inside the Reference
      // section (the default `en` locale is served at the site root).
      outDir: 'en/reference/api',
    }),
  ],
})
