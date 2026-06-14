/**
 * The request envelope — the single object all matchers and templates evaluate
 * against. It is part of the cross-language contract: any future client must
 * produce this exact shape. See CONTEXT.md and docs/adr/0009.
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

/** One response for a route. v1 ships inline `body` only. */
export interface Variant {
  /** HTTP status, default 200. */
  status?: number
  /** Response headers; `Content-Type` is inferred for object/array bodies unless set. */
  headers?: Record<string, string>
  /** Artificial latency in ms (reserved; not applied by the tracer-bullet engine). */
  delay?: number
  /** Inline response body. */
  body?: unknown
}

/**
 * Additional request-match conditions layered on a route. `{}` is the catch-all.
 * The tracer-bullet engine supports only the catch-all; the literal/JMESPath
 * matchers are implemented in later slices (#29/#30/#31).
 */
export interface Preset {
  query?: Record<string, string>
  headers?: Record<string, string>
  body?: unknown
  match?: string
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

/**
 * The only mutable state: the active collection (by name) plus, later, per-route
 * overrides (#27). Held per session (#39).
 */
export interface Selection {
  collection: string
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

export type MissReason =
  | { kind: 'no-collection'; collection: string }
  | { kind: 'no-route'; method: string; path: string }

export type MatchResult =
  | {
      type: 'matched'
      address: VariantAddress
      pathParams: Record<string, string>
      response: MockResponse
    }
  | { type: 'miss'; reason: MissReason; message: string }

/** The pure engine. `match` is referentially transparent given the definitions. */
export interface Engine {
  match(request: RequestEnvelope, selection: Selection): MatchResult
}
