import { defineConfig } from '@rspress/core'
import { pluginLlms } from '@rspress/plugin-llms'

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
  plugins: [pluginLlms()],
})
