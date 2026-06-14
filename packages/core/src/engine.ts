import { type CompiledPath, compilePath, matchPath } from './path'
import { buildResponse } from './response'
import type {
  Definitions,
  Engine,
  MatchResult,
  Preset,
  RequestEnvelope,
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

  return {
    match(request: RequestEnvelope, selection: Selection): MatchResult {
      const collection = definitions.collections.get(selection.collection)
      if (!collection) {
        return {
          type: 'miss',
          reason: { kind: 'no-collection', collection: selection.collection },
          message: `collection "${selection.collection}" is not defined`,
        }
      }

      const method = request.method.toUpperCase()
      for (const entry of collection.routes) {
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
