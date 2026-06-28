---
"@decoy/core": minor
---

Add `Engine.explain` / `Controller.explain` — a faithful step-by-step trace of how a request resolves.

`explain(request, selection)` runs the **same** resolution walk as `match` and additionally returns the ordered `TraceStep[]` the engine took: the request as the engine sees it, the active collection's resolved entries, each route considered (skipped or matched by method + path), each preset evaluated, the variant selected (and whether it templated), and the terminal outcome. Because it shares one code path with `match`, the trace can never drift from real matching. New exports: `TraceStep`, `ExplainResult`. This powers the standalone playground's "how the engine resolved it" view and is reusable for a future CLI `--explain` / panel trace.
