import type { Collection, Definitions, VariantAddress } from './types'

/**
 * Parse a `route:preset:variant` entry into its {@link VariantAddress} triple, or
 * `null` if it is not exactly three non-empty colon-separated parts.
 */
export function parseAddress(entry: string): VariantAddress | null {
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

/** The `route:preset` slot of an entry — the unit runtime overrides key on. */
export function slotOf(entry: string): string | null {
  const address = parseAddress(entry)
  return address ? `${address.route}:${address.preset}` : null
}

function parentOf(collection: Collection): string | undefined {
  return collection.from ?? collection.extends
}

/**
 * Resolve every collection's `from` chain into a flat, ordered entry list.
 * A child inherits its parent's entries first, then appends its own local entries
 * in authored order. Duplicates are preserved: the engine checks the resolved list
 * bottom-to-top, so a later child/local matching case wins without resolution-time
 * specificity or defaulting. Cyclic chains and references to undefined collections
 * throw — this is static, IO-free, and fails fast at engine creation.
 */
export function resolveCollections(collections: Map<string, Collection>): Map<string, string[]> {
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
      throw new Error(`collection "${id}" has a cyclic "from" chain`)
    }
    resolving.add(id)

    const parent = parentOf(collection)
    const entries = parent ? [...resolve(parent), ...collection.routes] : [...collection.routes]

    resolving.delete(id)
    resolved.set(id, entries)
    return entries
  }

  for (const id of collections.keys()) {
    resolve(id)
  }
  return resolved
}

/**
 * Resolve a single named collection to its ordered {@link VariantAddress} entries
 * after applying `from` (parent inherited first, child/local entries later).
 * Throws if the collection — or any collection it inherits from — is not defined,
 * or if its `from` chain is cyclic. Pure and IO-free: the control catalog
 * (`GET /__decoy__/collections/{name}`) reads scenarios through this.
 */
export function resolveCollection(definitions: Definitions, name: string): VariantAddress[] {
  const entries = resolveCollections(definitions.collections).get(name)
  if (!entries) {
    throw new Error(`collection "${name}" is not defined`)
  }
  return entries.map(parseAddress).filter((address): address is VariantAddress => address !== null)
}
