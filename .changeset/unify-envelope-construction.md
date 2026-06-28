---
"@decoy/core": minor
"@decoy/server": patch
"@decoy/express": patch
"@decoy/fastify": patch
"@decoy/nest": patch
"@decoy/playwright": patch
---

Unify `RequestEnvelope` construction into one `@decoy/core` module.

The header/cookie/query/path/body normalization that decides how a request matches was duplicated across all five transport adapters (`parseCookies`/`queryToObject` byte-identical, `normalizeHeaders` shared by four, `parseBody` by two). It now lives once at the core seam: `@decoy/core` exports `buildEnvelope`, `normalizeHeaders`, `parseBody`, and the `EnvelopeInput` type. Each adapter supplies only its raw transport facts and how it sources the body — the real per-adapter differences (server reads + JSON-parses the raw stream; Express/Nest/Fastify take the already-parsed `req.body` without consuming the stream; Playwright parses `postData()` by content type) are preserved exactly. No adapter behavior changes; the invariant is now tested once in core.
