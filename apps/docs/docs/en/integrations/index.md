---
title: Integrations
description: Wire Decoy into your stack — standalone server, Express, Fastify, Nest, and Playwright (router + server) — with the same mock definitions everywhere.
---

# Integrations

The same mock definitions — your `decoy.config.ts` plus `mocks/` — drive every adapter. What
changes between integrations is **where the engine runs** and **how you switch scenarios**: out of
process behind an HTTP control API, or in process behind a direct control handle.

Every page below is derived from a runnable project in [`examples/`](https://github.com/what3verCODE/decoy/tree/main/examples)
whose end-to-end test proves the setup works.

## Pick an adapter

**Out-of-process — a standalone Decoy server.** Point any client's base URL at it; switch scenarios
over the [`/__decoy__`](/guide/advanced/control-plane) HTTP API.

- [Standalone server (CLI)](/integrations/standalone) — run `decoy start` as a process in front of
  an upstream. The backend/full-stack dev story.

**In-process — Decoy embedded in your app.** Matched routes are served from mocks; a miss falls
through to your real handlers. No server, no `/__decoy__`: switch scenarios through the adapter's
in-process `control` handle.

- [Express](/integrations/express) — mount as middleware.
- [Fastify](/integrations/fastify) — register as a plugin.
- [Nest](/integrations/nest) — wire as a module.

**Browser↔API edge — fake the network from your tests.** A real browser drives a real SPA; Decoy
answers its `fetch` calls.

- [Playwright (router mode)](/integrations/playwright-router) — intercept in the browser over
  `page.route`, no server. The frontend-dev story.
- [Playwright (server mode)](/integrations/playwright-server) — drive a live Decoy server with
  per-session isolation for parallel workers. The full-stack/integration story.

> **Testplane** ships a `TestplaneRouter` over the same [Router](/guide/advanced/control-plane)
> interface; its integration page lands with its runnable example.

## What stays the same everywhere

- **The mocks.** One `decoy.config.ts` + `mocks/` directory, reused across adapters.
- **The verbs.** `useCollection` / `useRoute` / `reset` switch scenarios, whether you call them
  in-process or over HTTP — see [Control plane](/guide/advanced/control-plane).
- **Fail-closed.** An unmatched request never reaches a real backend; standalone and Fastify return
  `501 + x-mock-miss`, while pure middleware (Express, Nest) falls through to the host app's `404`.
