/**
 * The request envelope — the single object all matchers and templates evaluate
 * against. It is part of the cross-language contract: any future client must
 * produce this exact shape.
 */
export interface RequestEnvelope {
  method: string
  url: string
  path: string
  pathParams: Record<string, string>
  query: Record<string, string | string[]>
  headers: Record<string, string>
  cookies: Record<string, string>
  body: unknown
}

/**
 * One response for a route. v1 ships inline `body` only. Every field is rendered
 * through `${ }` templating against the request envelope: `status` and
 * `delay` widen to `number | string` so they too can be templated (a whole-string
 * `"${ expr }"` yields a typed number; an interpolated value is coerced).
 */
export interface Variant {
  /** HTTP status, default 200. Templated `${ }` strings are coerced to a number. */
  status?: number | string
  /** Response headers; `Content-Type` is inferred for object/array bodies unless set. */
  headers?: Record<string, string>
  /** Artificial latency in ms (reserved; not applied by the tracer-bullet engine). */
  delay?: number | string
  /** Inline response body. */
  body?: unknown
}

/**
 * Additional request-match conditions layered on a route, evaluated against the
 * request envelope and **ANDed** together. `{}` is the catch-all (no conditions →
 * always matches). Each field is either an **object pattern** or a **string
 * predicate**:
 * - **object** → a literal pattern: `query`/`headers` match as a subset (request
 *   must *contain* the pairs; extras ignored), `body` matches deep-partial (nested
 *   subset). Its string leaves are `${ }`-rendered first, so expected values can be
 *   computed from the request.
 * - **string** → a `${ }` predicate: rendered against the envelope, then gated on
 *   JMESPath truthiness (the field name documents what is checked; the expression
 *   roots at the whole envelope regardless).
 */
export interface Preset {
  query?: string | Record<string, string>
  headers?: string | Record<string, string>
  body?: unknown
}

/** The coarse matcher + namespace: `method` + `path` (OpenAPI `{id}` params) + `id`. */
export interface Route {
  id: string
  method: string
  path: string
  presets: Record<string, Preset>
  variants: Record<string, Variant>
}

/** An ordered list of `route:preset:variant` activations. `extends` is resolved in #27. */
export interface Collection {
  id: string
  extends?: string
  routes: string[]
}

/** The immutable definitions the engine matches against. */
export interface Definitions {
  routes: Map<string, Route>
  collections: Map<string, Collection>
}

/** A single-route override within a selection: pin a `route:preset` slot to a variant. */
export interface RouteOverride {
  route: string
  preset: string
  variant: string
}

/**
 * The only mutable state: the active collection (by name) plus per-route
 * overrides. Held per session (#39). An override pins the variant served for a
 * `route:preset` slot — replacing the collection's variant for an active slot,
 * or activating the slot if the collection does not include it.
 */
export interface Selection {
  collection: string
  overrides?: RouteOverride[]
}

/** A transport-agnostic response produced by the engine. */
export interface MockResponse {
  status: number
  headers: Record<string, string>
  body: unknown
}

/** The `route:preset:variant` triple identifying a served variant. */
export interface VariantAddress {
  route: string
  preset: string
  variant: string
}

/** A `route:preset` entry whose route matched by method+path but whose preset did not pass. */
export interface TriedPreset {
  route: string
  preset: string
}

export type MissReason =
  | { kind: 'no-collection'; collection: string }
  | { kind: 'no-route'; method: string; path: string }
  | { kind: 'no-preset'; method: string; path: string; tried: TriedPreset[] }

export type MatchResult =
  | {
      type: 'matched'
      address: VariantAddress
      pathParams: Record<string, string>
      response: MockResponse
    }
  | { type: 'miss'; reason: MissReason; message: string }

/**
 * One condition of a preset, evaluated against the request — the per-field detail of
 * a `preset` {@link TraceStep}, so a failed preset says *which* condition failed and
 * what it expected vs. what the request carried.
 */
export interface PresetFieldTrace {
  /** Which condition: a `${ }` `predicate`, or a `query`/`headers`/`body` pattern. */
  field: 'predicate' | 'query' | 'headers' | 'body'
  /** Whether this condition held against the request. */
  matched: boolean
  /** The rendered condition (the pattern, or `'truthy'` for a predicate). */
  expected: unknown
  /** The request value this condition was checked against. */
  actual: unknown
}

/**
 * One ordered step the engine took while resolving a request — the faithful record
 * an {@link Engine.explain} produces (same code path as `match`, so it never drifts
 * from real behavior). `ok` marks whether the step advanced toward a match.
 */
export type TraceStep =
  /** The request as the engine sees it (method, path, parsed query/body). */
  | { kind: 'request'; ok: true; method: string; path: string; detail: string }
  /** The active collection lookup and its resolved (post-`extends`, post-override) entries. */
  | { kind: 'collection'; ok: boolean; collection: string; entries: string[]; detail: string }
  /** An entry whose route was rejected before preset evaluation (unknown id, method, or path). */
  | { kind: 'route-skip'; ok: false; entry: string; detail: string }
  /** An entry whose route matched by method + path; `pathParams` are now known. */
  | {
      kind: 'route-match'
      ok: true
      route: string
      pathParams: Record<string, string>
      detail: string
    }
  /**
   * A preset evaluated against the request; `ok` is whether all its fields passed.
   * `fields` is the per-condition breakdown (absent when the preset itself was not
   * found, or for a catch-all with no conditions).
   */
  | {
      kind: 'preset'
      ok: boolean
      route: string
      preset: string
      detail: string
      fields?: PresetFieldTrace[]
    }
  /** The variant for a passed preset: `ok` is whether it exists (a missing variant is a miss). */
  | { kind: 'variant'; ok: boolean; route: string; preset: string; variant: string; detail: string }
  /** The terminal outcome: the served `route:preset:variant`, or the miss kind + message. */
  | { kind: 'outcome'; ok: boolean; resolution: string; detail: string }

/** The result of {@link Engine.explain}: the ordered trace plus the real {@link MatchResult}. */
export interface ExplainResult {
  steps: TraceStep[]
  result: MatchResult
}

/**
 * The pure engine. `match` is referentially transparent given the definitions;
 * `explain` runs the **same** resolution and additionally returns the ordered
 * {@link TraceStep}s the engine took to reach the result.
 */
export interface Engine {
  match(request: RequestEnvelope, selection: Selection): MatchResult
  explain(request: RequestEnvelope, selection: Selection): ExplainResult
}
