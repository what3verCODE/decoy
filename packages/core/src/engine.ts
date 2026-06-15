import {
  compile as compileJmespath,
  type JSONValue,
  TreeInterpreter,
} from '@jmespath-community/jmespath'
import { parseAddress, resolveCollections, slotOf } from './collections'
import { type CompiledPath, compilePath, matchPath } from './path'
import { buildResponse } from './response'
import type {
  Definitions,
  Engine,
  MatchResult,
  Preset,
  RequestEnvelope,
  RouteOverride,
  Selection,
  TriedPreset,
} from './types'

/** A pre-compiled JMESPath `match:` predicate (parsed once at engine creation). */
type Predicate = ReturnType<typeof compileJmespath>

/**
 * JMESPath truthiness: a value is *false* iff it is `null`/absent, the boolean
 * `false`, or an empty string/array/object — everything else (including `0`) is
 * truthy. A `match:` predicate matches when its evaluated result is truthy, so a
 * boolean comparison (`a == 'x'`) and a bare path (`body.flag`) both read
 * naturally, mirroring JMESPath filter (`[?expr]`) semantics.
 */
function isTruthy(value: JSONValue): boolean {
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

/**
 * A preset matches when *all* of its conditions hold against the request
 * envelope: `query`/`headers` as subset, `body` as deep-partial, and a JMESPath
 * `match:` predicate (pre-compiled) ANDed with them — every literal matcher and
 * the predicate must pass. A catch-all (`{}`) has no conditions and always
 * matches. The predicate is evaluated against the whole envelope and gates on
 * JMESPath truthiness (ADR-0008).
 */
function presetMatches(
  preset: Preset,
  request: RequestEnvelope,
  predicate: Predicate | undefined,
): boolean {
  if (preset.query !== undefined && !queryMatches(preset.query, request.query)) {
    return false
  }
  if (preset.headers !== undefined && !headersMatch(preset.headers, request.headers)) {
    return false
  }
  if (preset.body !== undefined && !deepPartialMatch(preset.body, request.body)) {
    return false
  }
  if (
    predicate !== undefined &&
    !isTruthy(TreeInterpreter.search(predicate, request as unknown as JSONValue))
  ) {
    return false
  }
  return true
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
  // Pre-compile every preset's JMESPath `match:` predicate once, keyed by preset
  // identity. An unparseable predicate throws here (fail-fast at creation, like a
  // cyclic extends) — config validation (#36) catches it earlier at load with
  // file:line; this is the engine's own backstop for programmatic definitions.
  const predicates = new Map<Preset, Predicate>()
  for (const [id, route] of definitions.routes) {
    compiled.set(id, compilePath(route.path))
    for (const [name, preset] of Object.entries(route.presets)) {
      if (preset.match === undefined) {
        continue
      }
      try {
        predicates.set(preset, compileJmespath(preset.match))
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        throw new Error(
          `route "${id}" preset "${name}" has an invalid match: predicate "${preset.match}": ${reason}`,
        )
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
        // no-preset miss, not a no-route miss.
        const preset = route.presets[address.preset]
        if (!preset || !presetMatches(preset, request, predicates.get(preset))) {
          tried.push({ route: address.route, preset: address.preset })
          continue
        }
        const variant = route.variants[address.variant]
        if (!variant) {
          tried.push({ route: address.route, preset: address.preset })
          continue
        }
        return {
          type: 'matched',
          address,
          pathParams,
          response: buildResponse(variant),
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
