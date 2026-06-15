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

/** The `route:preset` slot of an entry — the unit `extends`/overrides key on. */
export function slotOf(entry: string): string | null {
  const address = parseAddress(entry)
  return address ? `${address.route}:${address.preset}` : null
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
 * Resolve every collection's `extends` chain into a flat, ordered entry list.
 * A child inherits its parent's entries; an entry whose `route:preset` slot
 * already exists in the parent overrides it **in place** (keeping the parent's
 * order position), and any new slot is appended in child order. Cyclic chains
 * and references to undefined collections throw — this is static, IO-free, and
 * fails fast at engine creation.
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

/**
 * Resolve a single named collection to its ordered {@link VariantAddress} entries
 * after applying `extends` (parent inherited first, child overrides in place,
 * new slots appended). Throws if the collection — or any collection it extends —
 * is not defined, or if its `extends` chain is cyclic. Pure and IO-free: the
 * admin catalog (`GET /admin/collections/{name}`) reads scenarios through this.
 */
export function resolveCollection(definitions: Definitions, name: string): VariantAddress[] {
  const entries = resolveCollections(definitions.collections).get(name)
  if (!entries) {
    throw new Error(`collection "${name}" is not defined`)
  }
  return entries.map(parseAddress).filter((address): address is VariantAddress => address !== null)
}
