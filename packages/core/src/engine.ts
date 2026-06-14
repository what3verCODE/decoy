import { type CompiledPath, compilePath, matchPath } from './path'
import { buildResponse } from './response'
import type {
  Collection,
  Definitions,
  Engine,
  MatchResult,
  Preset,
  RequestEnvelope,
  RouteOverride,
  Selection,
  VariantAddress,
} from './types'

function parseAddress(entry: string): VariantAddress | null {
  const parts = entry.split(':')
  if (parts.length !== 3) {
    return null
  }
  const [route, preset, variant] = parts
  if (!route || !preset || !variant) {
    return null
  }
  return { route, preset, variant }
}

/**
 * Resolve every collection's `extends` chain into a flat, ordered entry list.
 * A child inherits its parent's entries; an entry whose `route:preset` slot
 * already exists in the parent overrides it **in place** (keeping the parent's
 * order position), and any new slot is appended in child order. Cyclic chains
 * and references to undefined collections throw — this is static, IO-free, and
 * fails fast at engine creation.
 */
function resolveCollections(collections: Map<string, Collection>): Map<string, string[]> {
  const resolved = new Map<string, string[]>()
  const resolving = new Set<string>()

  function resolve(id: string): string[] {
    const cached = resolved.get(id)
    if (cached) {
      return cached
    }
    const collection = collections.get(id)
    if (!collection) {
      throw new Error(`collection "${id}" is not defined`)
    }
    if (resolving.has(id)) {
      throw new Error(`collection "${id}" has a cyclic "extends" chain`)
    }
    resolving.add(id)

    let entries: string[]
    if (collection.extends) {
      entries = mergeEntries(resolve(collection.extends), collection.routes)
    } else {
      entries = [...collection.routes]
    }

    resolving.delete(id)
    resolved.set(id, entries)
    return entries
  }

  for (const id of collections.keys()) {
    resolve(id)
  }
  return resolved
}

/** The `route:preset` slot of an entry — the unit `extends`/overrides key on. */
function slotOf(entry: string): string | null {
  const address = parseAddress(entry)
  return address ? `${address.route}:${address.preset}` : null
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

/** Merge child entries onto parent entries: same slot overrides in place, new slots append. */
function mergeEntries(parent: string[], child: string[]): string[] {
  const result = [...parent]
  for (const entry of child) {
    const slot = slotOf(entry)
    const index = slot === null ? -1 : result.findIndex((existing) => slotOf(existing) === slot)
    if (index >= 0) {
      result[index] = entry
    } else {
      result.push(entry)
    }
  }
  return result
}

/**
 * The tracer-bullet engine supports the catch-all preset (`{}`) only. Presets
 * carrying literal/JMESPath conditions are not matched yet — that is #29/#30/#31.
 */
function presetMatches(preset: Preset, _request: RequestEnvelope): boolean {
  const hasConditions =
    preset.query !== undefined ||
    preset.headers !== undefined ||
    preset.body !== undefined ||
    preset.match !== undefined
  return !hasConditions
}

/**
 * Create the pure matching engine over an immutable set of definitions. The
 * returned `match(request, selection)` performs zero IO and is deterministic:
 * it walks the active collection's entries in array order and serves the first
 * whose route (method + path) and preset match — first match wins (ADR-0004).
 */
export function createEngine(definitions: Definitions): Engine {
  const compiled = new Map<string, CompiledPath>()
  for (const [id, route] of definitions.routes) {
    compiled.set(id, compilePath(route.path))
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
        const preset = route.presets[address.preset]
        if (!preset || !presetMatches(preset, request)) {
          continue
        }
        const variant = route.variants[address.variant]
        if (!variant) {
          continue
        }
        return {
          type: 'matched',
          address,
          pathParams,
          response: buildResponse(variant),
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
