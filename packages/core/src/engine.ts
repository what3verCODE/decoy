import type { JSONValue } from '@jmespath-community/jmespath'
import { parseAddress, resolveCollections, slotOf } from './collections'
import { type CompiledPath, compilePath, matchPath } from './path'
import { buildResponse } from './response'
import { compileTemplate, hasTemplates, type Renderer } from './template'
import type {
  Definitions,
  Engine,
  ExplainResult,
  MatchResult,
  Preset,
  PresetFieldTrace,
  RequestEnvelope,
  RouteOverride,
  Selection,
  TraceStep,
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
  | { mode: 'params'; render: Renderer }
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
 * Literal `params` match: subset semantics with exact-equality values — the
 * request must *contain* every specified `{param}` value (path params are always
 * single strings, so there is no array case).
 */
function paramsMatches(pattern: Record<string, string>, params: Record<string, string>): boolean {
  for (const [key, expected] of Object.entries(pattern)) {
    if (params[key] !== expected) {
      return false
    }
  }
  return true
}

/**
 * The path params to match against — read from `env`, not the request: a `{param}`
 * value isn't known until the route's path matches, so the engine folds it into the
 * templating env (`request.params` on the raw envelope is always empty).
 */
function envParams(env: JSONValue): Record<string, string> {
  const params = (env as { params?: unknown }).params
  return params !== null && typeof params === 'object' ? (params as Record<string, string>) : {}
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
 * Compile a preset into its field matchers: a **string** field is a
 * `${ }` predicate (gated on truthiness); an **object** field is a literal pattern
 * (`query`/`headers` subset, `body` deep-partial) whose string leaves are rendered
 * before matching. A catch-all (`{}`) compiles to no fields. Throws on a malformed
 * `${ }` expression (the engine's fail-fast backstop; validation catches it earlier
 * with `file:line`).
 */
function compilePreset(preset: Preset): FieldMatcher[] {
  const fields: FieldMatcher[] = []
  if (preset.params !== undefined) {
    const render = compileTemplate(preset.params)
    fields.push(
      typeof preset.params === 'string'
        ? { mode: 'predicate', render }
        : { mode: 'params', render },
    )
  }
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
    case 'params':
      return paramsMatches(stringifyRecord(field.render(env)), envParams(env))
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
 * envelope (with `params` known) — fields are ANDed. A catch-all (no fields)
 * always matches.
 */
function presetMatches(fields: FieldMatcher[], request: RequestEnvelope, env: JSONValue): boolean {
  return fields.every((field) => fieldMatches(field, request, env))
}

/**
 * Per-field diagnostic for the trace: evaluate each compiled field exactly as
 * {@link fieldMatches} does and record what it expected vs. what the request carried,
 * so an `explain` can say *which* condition failed (not just that one did).
 */
function explainField(
  field: FieldMatcher,
  request: RequestEnvelope,
  env: JSONValue,
): PresetFieldTrace {
  const rendered = field.render(env)
  switch (field.mode) {
    case 'predicate':
      return {
        field: 'predicate',
        matched: isTruthy(rendered),
        expected: 'truthy',
        actual: rendered,
      }
    case 'params': {
      const expected = stringifyRecord(rendered)
      const actual = envParams(env)
      return {
        field: 'params',
        matched: paramsMatches(expected, actual),
        expected,
        actual,
      }
    }
    case 'query': {
      const expected = stringifyRecord(rendered)
      return {
        field: 'query',
        matched: queryMatches(expected, request.query),
        expected,
        actual: request.query,
      }
    }
    case 'headers': {
      const expected = stringifyRecord(rendered)
      return {
        field: 'headers',
        matched: headersMatch(expected, request.headers),
        expected,
        actual: request.headers,
      }
    }
    case 'body':
      return {
        field: 'body',
        matched: deepPartialMatch(rendered, request.body),
        expected: rendered,
        actual: request.body,
      }
  }
}

function explainFields(
  fields: FieldMatcher[],
  request: RequestEnvelope,
  env: JSONValue,
): PresetFieldTrace[] {
  return fields.map((field) => explainField(field, request, env))
}

/** Summarize which preset conditions failed, for the `preset` trace step's detail line. */
function describePresetFail(traces: PresetFieldTrace[]): string {
  const failed = traces.filter((t) => !t.matched).map((t) => t.field)
  return failed.length === 0
    ? 'preset did not match'
    : `${failed.join(' + ')} condition${failed.length === 1 ? '' : 's'} did not match`
}

/**
 * Build the human diagnostic for a "route matched but no active preset matched"
 * miss. It names the matched route(s) and lists, in array order, the presets the
 * engine tried — the second miss type distinguishing a misfiring matcher from a
 * route that simply isn't activated.
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
 * whose route (method + path) and preset match — first match wins,
 * with no specificity scoring. A miss is one of three kinds: the collection is
 * undefined, no entry's route matched by method+path (`no-route`), or a route
 * matched but none of its active presets passed (`no-preset`, listing the
 * presets tried).
 */
export function createEngine(definitions: Definitions): Engine {
  const compiled = new Map<string, CompiledPath>()
  // Pre-compile every preset's field matchers and every variant's `${ }` renderer
  // once, keyed by identity (no per-request compile). A malformed
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

  /**
   * The single resolution walk shared by {@link Engine.match} and
   * {@link Engine.explain}: when `steps` is provided, each decision the engine
   * makes is recorded into it — so the trace is the *same* code path as a plain
   * match and can never drift from real behavior.
   */
  function resolve(
    request: RequestEnvelope,
    selection: Selection,
    steps?: TraceStep[],
  ): MatchResult {
    const record = (step: TraceStep): void => {
      steps?.push(step)
    }
    const method = request.method.toUpperCase()
    record({
      kind: 'request',
      ok: true,
      method,
      path: request.path,
      detail: `${method} ${request.path}`,
    })

    const entries = effective.get(selection.collection)
    if (!entries) {
      const message = `collection "${selection.collection}" is not defined`
      record({
        kind: 'collection',
        ok: false,
        collection: selection.collection,
        entries: [],
        detail: message,
      })
      record({ kind: 'outcome', ok: false, resolution: 'MISS(no-collection)', detail: message })
      return {
        type: 'miss',
        reason: { kind: 'no-collection', collection: selection.collection },
        message,
      }
    }
    const active = applyOverrides(entries, selection.overrides)
    record({
      kind: 'collection',
      ok: true,
      collection: selection.collection,
      entries: active,
      detail: `${active.length} active entr${active.length === 1 ? 'y' : 'ies'} to scan in order`,
    })

    // Entries whose route matched by method+path but whose preset (or variant)
    // did not yield a response — the basis for the no-preset miss diagnostic.
    const tried: TriedPreset[] = []
    for (const entry of active) {
      const address = parseAddress(entry)
      if (!address) {
        record({ kind: 'route-skip', ok: false, entry, detail: 'unparseable entry' })
        continue
      }
      const route = definitions.routes.get(address.route)
      if (!route) {
        record({ kind: 'route-skip', ok: false, entry, detail: `no route "${address.route}"` })
        continue
      }
      if (route.method.toUpperCase() !== method) {
        record({
          kind: 'route-skip',
          ok: false,
          entry,
          detail: `method ${route.method.toUpperCase()} ≠ ${method}`,
        })
        continue
      }
      const path = compiled.get(address.route)
      if (!path) {
        record({ kind: 'route-skip', ok: false, entry, detail: 'route has no compiled path' })
        continue
      }
      const params = matchPath(path, request.path)
      if (!params) {
        record({
          kind: 'route-skip',
          ok: false,
          entry,
          detail: `path ${route.path} ≠ ${request.path}`,
        })
        continue
      }
      record({
        kind: 'route-match',
        ok: true,
        route: address.route,
        params,
        detail: `${method} ${route.path} matched`,
      })
      // The route matched by method+path: from here, any failure to serve is a
      // no-preset miss, not a no-route miss. Templating roots at the request
      // envelope with the now-known params folded in.
      const env = { ...request, params } as unknown as JSONValue
      const preset = route.presets[address.preset]
      const fields = preset && presets.get(preset)
      if (!preset || !fields) {
        record({
          kind: 'preset',
          ok: false,
          route: address.route,
          preset: address.preset,
          detail: `preset "${address.preset}" not found`,
        })
        tried.push({ route: address.route, preset: address.preset })
        continue
      }
      // Compute the per-field breakdown only when tracing; otherwise the fast bool.
      const fieldTraces = steps ? explainFields(fields, request, env) : null
      const matched = fieldTraces
        ? fieldTraces.every((field) => field.matched)
        : presetMatches(fields, request, env)
      if (!matched) {
        record({
          kind: 'preset',
          ok: false,
          route: address.route,
          preset: address.preset,
          detail: fieldTraces ? describePresetFail(fieldTraces) : 'preset did not match',
          ...(fieldTraces ? { fields: fieldTraces } : {}),
        })
        tried.push({ route: address.route, preset: address.preset })
        continue
      }
      record({
        kind: 'preset',
        ok: true,
        route: address.route,
        preset: address.preset,
        detail:
          fields.length === 0
            ? 'catch-all (no conditions)'
            : `all ${fields.length} condition(s) matched`,
        ...(fieldTraces && fieldTraces.length > 0 ? { fields: fieldTraces } : {}),
      })
      const variant = route.variants[address.variant]
      if (!variant) {
        record({
          kind: 'variant',
          ok: false,
          route: address.route,
          preset: address.preset,
          variant: address.variant,
          detail: `variant "${address.variant}" not found`,
        })
        tried.push({ route: address.route, preset: address.preset })
        continue
      }
      const renderer = variantRenderers.get(variant)
      record({
        kind: 'variant',
        ok: true,
        route: address.route,
        preset: address.preset,
        variant: address.variant,
        detail: renderer ? 'rendered ${ } templates' : 'served verbatim (no templates)',
      })
      const rendered = renderer ? (renderer(env) as Variant) : variant
      const resolution = `${address.route}:${address.preset}:${address.variant}`
      record({ kind: 'outcome', ok: true, resolution, detail: resolution })
      return { type: 'matched', address, params, response: buildResponse(rendered) }
    }

    if (tried.length > 0) {
      const message = describeNoPresetMiss(method, request, tried)
      record({ kind: 'outcome', ok: false, resolution: 'MISS(no-preset)', detail: message })
      return {
        type: 'miss',
        reason: { kind: 'no-preset', method, path: request.path, tried },
        message,
      }
    }

    const message = `no route matched ${method} ${request.path}`
    record({ kind: 'outcome', ok: false, resolution: 'MISS(no-route)', detail: message })
    return { type: 'miss', reason: { kind: 'no-route', method, path: request.path }, message }
  }

  return {
    match(request: RequestEnvelope, selection: Selection): MatchResult {
      return resolve(request, selection)
    },
    explain(request: RequestEnvelope, selection: Selection): ExplainResult {
      const steps: TraceStep[] = []
      const result = resolve(request, selection, steps)
      return { steps, result }
    },
  }
}
