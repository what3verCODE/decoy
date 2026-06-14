import { createEngine } from './engine'
import type { Definitions, MatchResult, RequestEnvelope, RouteOverride, Selection } from './types'

/**
 * The canonical JS control API (ADR-0010). A controller owns the **selection** —
 * the only mutable state — and drives the pure engine. `setCollection`,
 * `useRoute`, and `reset` mutate the selection; switching is atomic, so the next
 * `match` sees the new state. Every control call validates against the
 * definitions and fails loud on an unknown collection/route/preset/variant.
 *
 * The engine stays stateless (ADR-0012); this is the stateful holder around it.
 * Cross-process control (`/admin`) and sessions wrap this same surface (#28/#39).
 */
export interface Controller {
  /** Match a request against the current selection. */
  match(request: RequestEnvelope): MatchResult
  /** Switch the active collection. Throws if `name` is not defined. */
  setCollection(name: string): void
  /** Pin a single route's `preset` slot to `variant` within the active collection. */
  useRoute(route: string, preset: string, variant: string): void
  /** Drop all per-route overrides, returning to the active collection's baseline. */
  reset(): void
  /** A read-only snapshot of the current selection. */
  readonly selection: Selection
}

function assertAddress(
  definitions: Definitions,
  route: string,
  preset: string,
  variant: string,
): void {
  const definition = definitions.routes.get(route)
  if (!definition) {
    throw new Error(`decoy: route "${route}" is not defined`)
  }
  if (!(preset in definition.presets)) {
    throw new Error(`decoy: preset "${preset}" is not defined on route "${route}"`)
  }
  if (!(variant in definition.variants)) {
    throw new Error(`decoy: variant "${variant}" is not defined on route "${route}"`)
  }
}

/** Create a {@link Controller} over the given definitions, starting on `defaultCollection`. */
export function createController(definitions: Definitions, defaultCollection: string): Controller {
  if (!definitions.collections.has(defaultCollection)) {
    throw new Error(`decoy: collection "${defaultCollection}" is not defined`)
  }
  const engine = createEngine(definitions)
  let collection = defaultCollection
  let overrides: RouteOverride[] = []

  return {
    get selection(): Selection {
      return { collection, overrides: overrides.map((override) => ({ ...override })) }
    },
    match(request) {
      return engine.match(request, { collection, overrides })
    },
    setCollection(name) {
      if (!definitions.collections.has(name)) {
        throw new Error(`decoy: collection "${name}" is not defined`)
      }
      collection = name
    },
    useRoute(route, preset, variant) {
      assertAddress(definitions, route, preset, variant)
      overrides = overrides.filter((o) => o.route !== route || o.preset !== preset)
      overrides.push({ route, preset, variant })
    },
    reset() {
      overrides = []
    },
  }
}
