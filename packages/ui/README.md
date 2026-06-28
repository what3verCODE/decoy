# @decoy/ui

The web control panel: a prebuilt SPA for driving scenarios from a browser. Ships **static assets
only** — `@decoy/server` lazily resolves and serves them with `decoy start --ui`.

**Role** · the opt-in panel served at the same-origin control mount.
**Exports** · `uiAssetDir()` (path to the built SPA) and `version` — its sole runtime surface; the
panel itself is a separately-built client bundle.
**Depends on** · nothing at runtime (the client talks to the `/__decoy__` API over HTTP).
**Used by** · `@decoy/server` (`--ui` mount).

Control plane → `/guide/advanced/control-plane`.
