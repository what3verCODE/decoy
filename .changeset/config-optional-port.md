---
"@decoy/config": minor
---

`port` is now optional in a service config (defaults to `4000`).

It was the only required field, yet it's a server-transport concern with no meaning for the in-process router surfaces (e.g. `@decoy/playwright`), which boot no server. A no-server config can now be just `{ routesDir, collectionsFile, defaultCollection }` — all of which already default — joining `name` and the rest as optional. Existing configs that set `port` are unaffected; the loader still defaults it and duplicate-port detection (ADR-0006) is unchanged.
