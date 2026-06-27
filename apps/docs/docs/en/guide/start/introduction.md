---
title: Introduction
description: What Decoy is, the problem it solves, and why you'd reach for it.
---

# Introduction

Decoy is a fast, contract-first HTTP mock you point a base URL at. You author mock
**routes**, group them into switchable **collections**, point any client's base URL at the
running server, and develop or test against deterministic scenarios — without waiting for a
real backend to exist, stabilise, or come back online.

## The problem

Front-ends and services are built against APIs that are slow, flaky, rate-limited, or simply
not finished yet. The usual workarounds each have a sharp edge:

- **Hand-rolled mock servers** drift from the real contract and rot.
- **Record/replay proxies** couple your tests to a live upstream and leak real traffic.
- **In-process stubs** can't exercise the real network path your client takes.

The failure mode they share is the worst one for a test suite: a request that *silently* hits
the real API, making a run pass for the wrong reason.

## What Decoy does

You point a base URL at Decoy and it answers from definitions you control:

- **Routes** describe one endpoint's responses.
- **Collections** bundle routes into a whole scenario you can switch atomically — "logged-out",
  "payment-declined", "empty-state".
- **Fail-closed by default** means an unmatched request returns an explicit error instead of
  reaching the network, so a misconfigured test fails loudly instead of passing quietly.

Because matching is deterministic, the same request resolves to the same response every time —
the property a test suite needs most.

## Why you'd use it

- **Deterministic e2e** — Playwright and Testplane get first-class fixtures; each parallel test
  isolates its own scenario through a session header.
- **One tool, many surfaces** — the same definitions drive a standalone server and CLI, plus
  Express, Nest, and Fastify adapters.
- **Develop offline** — build against a scenario before the backend exists, then keep it as a
  regression fixture.

## Next steps

This page is the front door. [Getting Started](/guide/start/getting-started) walks you from
install to a first running mock; from there the Guide covers configuration, matching, sessions,
and the control plane. Integrations cover each adapter, and the Reference documents config and
the control API in full.
