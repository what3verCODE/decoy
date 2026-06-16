---
"@decoy/config": minor
"@decoy/server": minor
"@decoy/control": minor
"@decoy/ui": minor
---

Deepen the control plane into the instance: `serveControl` + unify on "control" (retire "admin").

The control surface is now one concept — **control** — served by one handler mounted in two places (the cross-process mount on the mock port and the same-origin `--ui` panel mount), sharing a collision-safe default prefix.

- `@decoy/config` — the `admin` service-config key is renamed **`control`** (`control.prefix/port/enabled`), the resolved type `ResolvedAdmin` → **`ResolvedControl`** (`LoadedService.control`), and the default mount prefix changes from `/admin` to **`/__decoy__`** (distinctive, so it won't shadow a real upstream route — the separate-port escape hatch is now almost never needed).
- `@decoy/server` — `DecoyServer` gains **`serveControl(req, res)`**: the same control handler, closing over the instance's own sessions/definitions/request-log store/resolution and absorbing the handler→`500` so neither mount repeats it. The `--ui` aggregator now routes a `?service=`-selected request through the target's `serveControl` (logs still aggregate across services, since the CLI shares one store). The interface shrinks — `sessions`, `requestLog`, `missStatus`, and `passthrough` accessors are **dropped** (only `--ui` read them, and it no longer reaches across the seam); `adminPort` → **`controlPort`**. `CONTROL_PREFIX` is exported.
- `@decoy/control` — the client's default prefix follows the server: `/admin` → `/__decoy__` (the `AdminClient` name is unchanged here; see #81).
- `@decoy/ui` — the SPA's same-origin data API moves from `/admin/*` to `/__decoy__/*`.

**Breaking:** the `admin` config key, `ResolvedAdmin`, the `/admin` default prefix, `DecoyServer.adminPort`, and the dropped `DecoyServer` accessors. Pre-release — no deprecation path.
