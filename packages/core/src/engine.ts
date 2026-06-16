import type { JSONValue } from '@jmespath-community/jmespath'
import { parseAddress, resolveCollections, slotOf } from './collections'
import { type CompiledPath, compilePath, matchPath } from './path'
import { buildResponse } from './response'
import { compileTemplate, hasTemplates, type Renderer } from './template'
import type {
  Definitions,
  Engine,
  MatchResult,
  Preset,
  RequestEnvelope,
  RouteOverride,
  Selection,
  TriedPreset,
  Variant,
} from './types'

/**
 * A compiled preset field, tagged by how its rendered result is checked: a
 * `predicate` (string field) gates on JMESPath truthiness; `query`/`headers`/`body`
 * (object patterns) match structurally after their string leaves are rendered.
 */
type FieldMatcher =
  | { mode: 'predicate'; render: Renderer }
  | { mode: 'query'; render: Renderer }
  | { mode: 'headers'; render: Renderer }
  | { mode: 'body'; render: Renderer }

/**
 * JMESPath truthiness: a value is *false* iff it is `null`/absent, the boolean
 * `false`, or an empty string/array/object — everything else (including `0`) is
 * truthy. A string predicate matches when its rendered result is truthy, so a
 * boolean comparison (`a == 'x'`) and a bare path (`body.flag`) both read
 * naturally, mirroring JMESPath filter (`[?expr]`) semantics.
 */
function isTruthy(value: unknown): boolean {
  if (value === null || value === false) {
    return false
  }
  if (typeof value === 'string') {
    return value.length > 0
  }
  if (Array.isArray(value)) {
    return value.length > 0
  }
  if (typeof value === 'object') {
    return Object.keys(value).length > 0
  }
  return true
}

/**
 * Apply selection overrides to a collection's resolved entries: an override pins
 * a `route:preset` slot to a variant — swapping the variant of an active slot in
 * place, or appending a synthesized entry for a slot the collection omits. Later
 * overrides for the same slot win.
 */
function applyOverrides(entries: string[], overrides: RouteOverride[] | undefined): string[] {
  if (!overrides || overrides.length === 0) {
    return entries
  }
  const bySlot = new Map<string, string>()
  for (const { route, preset, variant } of overrides) {
    bySlot.set(`${route}:${preset}`, variant)
  }
  const used = new Set<string>()
  const result = entries.map((entry) => {
    const slot = slotOf(entry)
    if (slot === null) {
      return entry
    }
    const variant = bySlot.get(slot)
    if (variant === undefined) {
      return entry
    }
    used.add(slot)
    return `${slot}:${variant}`
  })
  for (const [slot, variant] of bySlot) {
    if (!used.has(slot)) {
      result.push(`${slot}:${variant}`)
    }
  }
  return result
}

/**
 * Literal `query` match: subset semantics — the request must *contain* every
 * specified key/value pair; extras are ignored. A repeated query key arrives as
 * an array, in which case the request matches if the array contains the value.
 */
function queryMatches(pattern: Record<string, string>, query: RequestEnvelope['query']): boolean {
  for (const [key, expected] of Object.entries(pattern)) {
    const actual = query[key]
    if (actual === undefined) {
      return false
    }
    if (Array.isArray(actual) ? !actual.includes(expected) : actual !== expected) {
      return false
    }
  }
  return true
}

/**
 * Literal `headers` match: subset semantics with case-insensitive header *names*
 * (HTTP headers are case-insensitive) and exact-equality values.
 */
function headersMatch(pattern: Record<string, string>, headers: Record<string, string>): boolean {
  const byLowerName = new Map<string, string>()
  for (const [name, value] of Object.entries(headers)) {
    byLowerName.set(name.toLowerCase(), value)
  }
  for (const [name, expected] of Object.entries(pattern)) {
    if (byLowerName.get(name.toLowerCase()) !== expected) {
      return false
    }
  }
  return true
}

/**
 * Deep-partial (nested subset) match: the request value must *contain* the
 * pattern. Objects match when every pattern key is present and deep-partial
 * matches (sibling keys ignored); arrays match element-wise by index (extra
 * trailing elements ignored); every other value matches by strict equality.
 */
function deepPartialMatch(pattern: unknown, value: unknown): boolean {
  if (Array.isArray(pattern)) {
    return (
      Array.isArray(value) && pattern.every((item, index) => deepPartialMatch(item, value[index]))
    )
  }
  if (pattern !== null && typeof pattern === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return false
    }
    const target = value as Record<string, unknown>
    return Object.entries(pattern as Record<string, unknown>).every(
      ([key, expected]) => Object.hasOwn(target, key) && deepPartialMatch(expected, target[key]),
    )
  }
  return pattern === value
}

/** Coerce a rendered pattern object's leaves to strings for query/headers comparison. */
function stringifyRecord(value: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, leaf] of Object.entries(value)) {
      out[key] = typeof leaf === 'string' ? leaf : leaf == null ? '' : String(leaf)
    }
  }
  return out
}

/**
 * Compile a preset into its field matchers (ADR-0008): a **string** field is a
 * `${ }` predicate (gated on truthiness); an **object** field is a literal pattern
 * (`query`/`headers` subset, `body` deep-partial) whose string leaves are rendered
 * before matching. A catch-all (`{}`) compiles to no fields. Throws on a malformed
 * `${ }` expression (the engine's fail-fast backstop; validation catches it earlier
 * with `file:line`).
 */
function compilePreset(preset: Preset): FieldMatcher[] {
  const fields: FieldMatcher[] = []
  if (preset.query !== undefined) {
    const render = compileTemplate(preset.query)
    fields.push(
      typeof preset.query === 'string' ? { mode: 'predicate', render } : { mode: 'query', render },
    )
  }
  if (preset.headers !== undefined) {
    const render = compileTemplate(preset.headers)
    fields.push(
      typeof preset.headers === 'string'
        ? { mode: 'predicate', render }
        : { mode: 'headers', render },
    )
  }
  if (preset.body !== undefined) {
    const render = compileTemplate(preset.body)
    fields.push(
      typeof preset.body === 'string' ? { mode: 'predicate', render } : { mode: 'body', render },
    )
  }
  return fields
}

/**
 * Render one compiled field and check it against the request: a `predicate` gates
 * on JMESPath truthiness; `query`/`headers`/`body` patterns match structurally.
 */
function fieldMatches(field: FieldMatcher, request: RequestEnvelope, env: JSONValue): boolean {
  switch (field.mode) {
    case 'predicate':
      return isTruthy(field.render(env))
    case 'query':
      return queryMatches(stringifyRecord(field.render(env)), request.query)
    case 'headers':
      return headersMatch(stringifyRecord(field.render(env)), request.headers)
    case 'body':
      return deepPartialMatch(field.render(env), request.body)
  }
}

/**
 * A preset matches when *all* of its compiled fields hold against the request
 * envelope (with `pathParams` known) — fields are ANDed. A catch-all (no fields)
 * always matches.
 */
function presetMatches(fields: FieldMatcher[], request: RequestEnvelope, env: JSONValue): boolean {
  return fields.every((field) => fieldMatches(field, request, env))
}

/**
 * Build the human diagnostic for a "route matched but no active preset matched"
 * miss. It names the matched route(s) and lists, in array order, the presets the
 * engine tried — the second miss type distinguishing a misfiring matcher from a
 * route that simply isn't activated (ADR-0005, DESIGN §6).
 */
function describeNoPresetMiss(
  method: string,
  request: RequestEnvelope,
  tried: TriedPreset[],
): string {
  const routes = [...new Set(tried.map((t) => t.route))]
  const hint =
    Object.keys(request.query).length > 0 ? ` (query ${JSON.stringify(request.query)})` : ''
  if (routes.length === 1) {
    const presets = tried.map((t) => t.preset).join(', ')
    return `route "${routes[0]}" matched ${method} ${request.path}${hint} but no active preset matched; presets tried: ${presets}`
  }
  const slots = tried.map((t) => `${t.route}:${t.preset}`).join(', ')
  return `routes matched ${method} ${request.path}${hint} but no active preset matched; presets tried: ${slots}`
}

/**
 * Create the pure matching engine over an immutable set of definitions. The
 * returned `match(request, selection)` performs zero IO and is deterministic:
 * it walks the active collection's entries in array order and serves the first
 * whose route (method + path) and preset match — first match wins (ADR-0004),
 * with no specificity scoring. A miss is one of three kinds: the collection is
 * undefined, no entry's route matched by method+path (`no-route`), or a route
 * matched but none of its active presets passed (`no-preset`, listing the
 * presets tried).
 */
export function createEngine(definitions: Definitions): Engine {
  const compiled = new Map<string, CompiledPath>()
  // Pre-compile every preset's field matchers and every variant's `${ }` renderer
  // once, keyed by identity (ADR-0009: no per-request compile). A malformed
  // expression throws here (fail-fast at creation, like a cyclic extends) — config
  // validation catches it earlier at load with file:line; this is the engine's own
  // backstop for programmatic definitions. A variant with no templates is stored as
  // `null` (the no-template fast path: served verbatim, no per-request render).
  const presets = new Map<Preset, FieldMatcher[]>()
  const variantRenderers = new Map<Variant, Renderer | null>()
  for (const [id, route] of definitions.routes) {
    compiled.set(id, compilePath(route.path))
    for (const [name, preset] of Object.entries(route.presets)) {
      try {
        presets.set(preset, compilePreset(preset))
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        throw new Error(`route "${id}" preset "${name}" has an invalid \${ } expression: ${reason}`)
      }
    }
    for (const [name, variant] of Object.entries(route.variants)) {
      try {
        variantRenderers.set(variant, hasTemplates(variant) ? compileTemplate(variant) : null)
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        throw new Error(`route "${id}" variant "${name}" has an invalid \${ } template: ${reason}`)
      }
    }
  }
  const effective = resolveCollections(definitions.collections)

  return {
    match(request: RequestEnvelope, selection: Selection): MatchResult {
      const entries = effective.get(selection.collection)
      if (!entries) {
        return {
          type: 'miss',
          reason: { kind: 'no-collection', collection: selection.collection },
          message: `collection "${selection.collection}" is not defined`,
        }
      }

      const method = request.method.toUpperCase()
      // Entries whose route matched by method+path but whose preset (or variant)
      // did not yield a response — the basis for the no-preset miss diagnostic.
      const tried: TriedPreset[] = []
      for (const entry of applyOverrides(entries, selection.overrides)) {
        const address = parseAddress(entry)
        if (!address) {
          continue
        }
        const route = definitions.routes.get(address.route)
        if (!route || route.method.toUpperCase() !== method) {
          continue
        }
        const path = compiled.get(address.route)
        if (!path) {
          continue
        }
        const pathParams = matchPath(path, request.path)
        if (!pathParams) {
          continue
        }
        // The route matched by method+path: from here, any failure to serve is a
        // no-preset miss, not a no-route miss. Templating roots at the request
        // envelope with the now-known pathParams folded in (ADR-0009).
        const env = { ...request, pathParams } as unknown as JSONValue
        const preset = route.presets[address.preset]
        const fields = preset && presets.get(preset)
        if (!preset || !fields || !presetMatches(fields, request, env)) {
          tried.push({ route: address.route, preset: address.preset })
          continue
        }
        const variant = route.variants[address.variant]
        if (!variant) {
          tried.push({ route: address.route, preset: address.preset })
          continue
        }
        const renderer = variantRenderers.get(variant)
        const rendered = renderer ? (renderer(env) as Variant) : variant
        return {
          type: 'matched',
          address,
          pathParams,
          response: buildResponse(rendered),
        }
      }

      if (tried.length > 0) {
        return {
          type: 'miss',
          reason: { kind: 'no-preset', method, path: request.path, tried },
          message: describeNoPresetMiss(method, request, tried),
        }
      }

      return {
        type: 'miss',
        reason: { kind: 'no-route', method, path: request.path },
        message: `no route matched ${method} ${request.path}`,
      }
    },
  }
}
