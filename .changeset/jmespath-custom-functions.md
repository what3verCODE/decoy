---
"@decoy/core": minor
"@decoy/config": minor
---

Custom JMESPath functions via `defineConfig({ jmespath: { functions } })`.

Register your own JMESPath functions for `${ }` templates and preset predicates, composing with the standard library. Each is `{ name, signature, func }` — the same shape as a standard function — and is authored in a `.ts`/`.js` config only (the function is code; mock files stay declarative). The headline use is fabricating data the query language can't (ids, timestamps, synthetic records).

```ts
import { defineConfig } from '@decoy/config'

export default defineConfig({
  jmespath: {
    functions: [{ name: 'answer', signature: [], func: () => 42 }],
  },
})
// → `${ answer() }` now renders 42
```

- `@decoy/core` adds `registerCustomFunctions`, the `CustomFunction` type, and re-exports `InputSignature`; functions register through the same idempotent, standard-safe seam as the standard library.
- `@decoy/config` adds the `jmespath` option (and `JmespathConfig`/`validateJmespath`, plus re-exported `CustomFunction`/`InputSignature` for authoring). Functions are validated and registered at load; a name that shadows a standard function, or repeats within the set, is a clear load-time error caught by `decoy check`.
