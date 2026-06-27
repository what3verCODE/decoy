import { createEngine } from './engine'
import type { Definitions, MatchResult, RequestEnvelope, RouteOverride, Selection } from './types'

/**
 * The outcome of {@link Controller.reload}: what the controller did to keep the
 * selection valid against the swapped definitions. Returned so a transport can
 * warn (e.g. a vanished collection) without the pure controller doing IO.
 */
export interface ReloadResult {
  /** True when the active collection vanished and the selection fell back to `defaultCollection`. */
  collectionFellBack: boolean
  /** The active collection after the reload (the preserved one, or the fallback). */
  collection: string
  /** Overrides dropped because their `route:preset:variant` no longer resolves. */
  droppedOverrides: RouteOverride[]
}

/**
 * The canonical JS control API. A controller owns the **selection** —
 * the only mutable state — and drives the pure engine. `useCollection`,
 * `useRoute`, and `reset` mutate the selection; switching is atomic, so the next
 * `match` sees the new state. Every control call validates against the
 * definitions and fails loud on an unknown collection/route/preset/variant.
 *
 * The engine stays stateless; this is the stateful holder around it.
 * Cross-process control (`/__decoy__`) and sessions wrap this same surface (#28/#39).
 */
export interface Controller {
  /** Match a request against the current selection. */
  match(request: RequestEnvelope): MatchResult
  /** Switch the active collection. Throws if `name` is not defined. */
  useCollection(name: string): void
  /** Pin a single route's `preset` slot to `variant` within the active collection. */
  useRoute(route: string, preset: string, variant: string): void
  /** Drop all per-route overrides, returning to the active collection's baseline. */
  reset(): void
  /**
   * Swap the definitions the controller matches against (hot reload, #44),
   * preserving the selection **by name**: the active collection is kept if it
   * still exists, else the selection falls back to `defaultCollection`; overrides
   * whose `route:preset:variant` no longer resolves are dropped. The engine is
   * rebuilt in place so existing holders of this controller keep working. Throws
   * if `defaultCollection` is not defined in the new definitions.
   */
  reload(definitions: Definitions, defaultCollection: string): ReloadResult
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

/** Whether an override's `route:preset:variant` resolves against the definitions. */
function overrideResolves(definitions: Definitions, override: RouteOverride): boolean {
  const route = definitions.routes.get(override.route)
  return (
    route !== undefined && override.preset in route.presets && override.variant in route.variants
  )
}

/** Create a {@link Controller} over the given definitions, starting on `defaultCollection`. */
export function createController(definitions: Definitions, defaultCollection: string): Controller {
  if (!definitions.collections.has(defaultCollection)) {
    throw new Error(`decoy: collection "${defaultCollection}" is not defined`)
  }
  let defs = definitions
  let engine = createEngine(defs)
  let collection = defaultCollection
  let overrides: RouteOverride[] = []

  return {
    get selection(): Selection {
      return { collection, overrides: overrides.map((override) => ({ ...override })) }
    },
    match(request) {
      return engine.match(request, { collection, overrides })
    },
    useCollection(name) {
      if (!defs.collections.has(name)) {
        throw new Error(`decoy: collection "${name}" is not defined`)
      }
      collection = name
    },
    useRoute(route, preset, variant) {
      assertAddress(defs, route, preset, variant)
      overrides = overrides.filter((o) => o.route !== route || o.preset !== preset)
      overrides.push({ route, preset, variant })
    },
    reset() {
      overrides = []
    },
    reload(next, nextDefault) {
      if (!next.collections.has(nextDefault)) {
        throw new Error(`decoy: collection "${nextDefault}" is not defined`)
      }
      defs = next
      engine = createEngine(defs)

      let collectionFellBack = false
      if (!defs.collections.has(collection)) {
        collection = nextDefault
        collectionFellBack = true
      }

      const droppedOverrides = overrides.filter((o) => !overrideResolves(defs, o))
      overrides = overrides.filter((o) => overrideResolves(defs, o))

      return { collectionFellBack, collection, droppedOverrides }
    },
  }
}
