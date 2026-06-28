---
"@decoy/core": minor
"@decoy/config": minor
---

Rename the request envelope's `pathParams` to `params`, and add it as a preset match condition.

**Breaking (pre-release):** the path-params field is now `params` everywhere — the request envelope, `${ }` templating (`${ params.id }`), and `MatchResult`. Update any templates from `${ pathParams.x }` to `${ params.x }`.

A preset can now also match on `params`, alongside `query`/`headers`/`body`:

```yaml
presets:
  ada:
    params: { id: "42" }   # only matches GET /users/42
```

Like the others it accepts a literal pattern (subset, exact-equality) or a `${ }` predicate string, the values are `${ }`-rendered first, and a failed `params` condition shows up in the `explain()` trace's per-field breakdown. The values are read from the matched path (they aren't known on the raw request envelope until the route matches).
