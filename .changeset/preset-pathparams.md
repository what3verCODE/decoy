---
"@decoy/core": minor
"@decoy/config": minor
---

Add `pathParams` as a preset match condition.

A preset can now match on the route's `{param}` path segments, alongside `query`/`headers`/`body`:

```yaml
presets:
  ada:
    pathParams: { id: "42" }   # only matches GET /users/42
```

Like the others it accepts a literal pattern (subset, exact-equality) or a `${ }` predicate string, the params are `${ }`-rendered first, and a failed `pathParams` condition shows up in the `explain()` trace's per-field breakdown. The values are read from the matched path (they aren't known on the raw request envelope until the route matches).
