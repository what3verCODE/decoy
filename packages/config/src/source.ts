import { readFile } from 'node:fs/promises'
import { LineCounter, parseDocument } from 'yaml'

/** A path into a parsed value: object keys (strings) and array indices (numbers). */
export type ValuePath = ReadonlyArray<string | number>

/**
 * A parsed **mock** source file (a `routesDir` route or the `collectionsFile`)
 * that can resolve a value path back to the 1-based line it was authored on — the
 * basis for every mock-file validation issue's `file:line`. YAML and JSON (a YAML
 * 1.2 subset) are parsed through the `yaml` document model so node ranges are
 * available. The config file itself no longer flows through here: its discovery
 * and loading are owned by cosmiconfig, and its validation reports a
 * service-scoped message rather than `file:line`.
 */
export interface SourceDoc {
  /** Absolute path of the file this document came from. */
  file: string
  /** The parsed plain JS value (objects/arrays/scalars). */
  data: unknown
  /** Resolve a value path to its 1-based authoring line, or `undefined` if unknown. */
  lineAt(path: ValuePath): number | undefined
}

/**
 * Read and parse a declarative mock file (YAML/JSON) into a {@link SourceDoc} that
 * retains line positions. JSON is parsed through the same YAML document model
 * since YAML 1.2 is a superset of JSON, giving both formats `file:line`.
 */
export async function loadSourceDoc(file: string): Promise<SourceDoc> {
  const raw = await readFile(file, 'utf8')
  const lineCounter = new LineCounter()
  const doc = parseDocument(raw, { lineCounter })
  const data = doc.toJS()
  return {
    file,
    data,
    lineAt(path) {
      const node = doc.getIn(path, true) as { range?: [number, number, number] } | undefined
      if (node?.range) {
        return lineCounter.linePos(node.range[0]).line
      }
      return undefined
    },
  }
}

/** A `lineAt` bound to a sub-path of a {@link SourceDoc} — relative paths resolve under `base`. */
export type LineAt = (path: ValuePath) => number | undefined

/** Bind a {@link SourceDoc}'s `lineAt` to a base path so callers pass paths relative to it. */
export function bindLineAt(doc: SourceDoc, base: ValuePath = []): LineAt {
  if (base.length === 0) {
    return (path) => doc.lineAt(path)
  }
  return (path) => doc.lineAt([...base, ...path])
}
