---
title: AI
description: Point your AI tooling at Decoy's machine-readable docs — llms.txt, llms-full.txt, and per-page Markdown.
---

# AI

These docs ship a machine-readable surface so you can point an AI agent or LLM-powered editor
at Decoy and have it answer accurately — from the same source a human reads, never a stale
copy. Every page is generated as Markdown alongside its HTML, and two index files summarize the
whole site.

## The surface

| File | What it is |
| --- | --- |
| `/llms.txt` | A concise index of the site: title, description, and a linked list of every page. Hand this to an agent as the entry point. |
| `/llms-full.txt` | The entire documentation concatenated into one Markdown file — drop it into a context window when you want the agent to read everything at once. |
| `/<page>.md` | The raw Markdown for any individual page. Append `.md` to a page's URL to fetch just that page. |

These are emitted at build time by the [`@rspress/plugin-llms`](https://rspress.rs) plugin, so
they regenerate on every docs build and can never drift from the rendered pages.

## Fetch a single page as Markdown

Any page is available as plain Markdown by appending `.md` to its path. For example, the
Getting Started page:

```sh
curl -s /guide/start/getting-started.md
```

Paths are relative to wherever the site is hosted (the base path is configurable and the deploy
target is host-agnostic), so prefix them with your docs origin.

## Point an agent at the docs

- **Whole site into context** — give your agent `/llms-full.txt` when you want it to reason over
  all of Decoy's docs in a single pass.
- **Index-then-fetch** — give it `/llms.txt` so it can see the page list and pull only the
  pages it needs as Markdown via the per-page `.md` URLs. Cheaper on tokens for a large site.
- **One page** — paste a single `/<page>.md` when a question is scoped to one topic (e.g. just
  Getting Started or the control plane).

## Next steps

- [Getting Started](/guide/start/getting-started) — install Decoy and serve a first mock.
- [Introduction](/guide/start/introduction) — what Decoy is and why you'd reach for it.
