---
pageType: home

hero:
  name: Decoy
  text: A contract-first HTTP mock you point a base URL at
  tagline: Develop and test against deterministic scenarios without waiting for a backend.
  actions:
    - theme: brand
      text: Introduction
      link: /guide/start/introduction
    - theme: alt
      text: GitHub
      link: https://github.com/what3verCODE/decoy

features:
  - title: Fail-closed by default
    details: An unmatched request returns an error, never a silent pass-through to the real API. A test can't accidentally reach production.
    icon: 🔒
  - title: Deterministic matching
    details: Author routes grouped into switchable collections. The same request always resolves to the same variant, so runs are reproducible.
    icon: 🎯
  - title: Multi-adapter
    details: First-class e2e fixtures for Playwright and Testplane, middleware for Express, Nest, and Fastify, plus a standalone server and CLI.
    icon: 🔌
  - title: Session isolation
    details: Parallel tests each pin their own collection and overrides via an x-mock-session header — no cross-talk, no shared mutable state.
    icon: 🧪
---
