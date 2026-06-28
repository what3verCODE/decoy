---
"@decoy/core": minor
---

Add a per-field breakdown to the `preset` trace step from `explain()`.

A `preset` {@link TraceStep} now carries an optional `fields: PresetFieldTrace[]` — one entry per condition (`predicate` / `query` / `headers` / `body`) with `matched` and the rendered `expected` vs. the request's `actual`. A failed preset's `detail` also names the failing condition(s) (e.g. `"headers condition did not match"`), so a trace says *what* didn't match, not just that something did. New export: `PresetFieldTrace`. The per-field work runs only under `explain` (when tracing); plain `match` is unchanged.
