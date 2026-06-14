import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { LineCounter, parseDocument } from 'yaml'

/** A path into a parsed value: object keys (strings) and array indices (numbers). */
export type ValuePath = ReadonlyArray<string | number>

/**
 * A parsed source file that can resolve a value path back to the 1-based line it
 * was authored on — the basis for every validation issue's `file:line`. YAML and
 * JSON (a YAML 1.2 subset) are parsed through the `yaml` document model so node
 * ranges are available; TS/JS configs loaded via jiti have no source map, so
 * their {@link lineAt} always returns `undefined` (the issue still carries the file).
 */
export interface SourceDoc {
  /** Absolute path of the file this document came from. */
  file: string
  /** The parsed plain JS value (objects/arrays/scalars). */
  data: unknown
  /** Resolve a value path to its 1-based authoring line, or `undefined` if unknown. */
  lineAt(path: ValuePath): number | undefined
}

/** Extensions whose source can be parsed for line positions via the `yaml` model. */
const LINE_AWARE_EXTENSIONS = new Set(['.yaml', '.yml', '.json'])

/**
 * Read and parse a declarative source file (YAML/JSON) into a {@link SourceDoc}
 * that retains line positions. JSON is parsed through the same YAML document
 * model since YAML 1.2 is a superset of JSON, giving both formats `file:line`.
 */
export async function loadSourceDoc(file: string): Promise<SourceDoc> {
  const raw = await readFile(file, 'utf8')
  const ext = extname(file).toLowerCase()
  if (!LINE_AWARE_EXTENSIONS.has(ext)) {
    // Should not happen for mock files; fall back to a line-less doc to be safe.
    return inlineSourceDoc(file, undefined)
  }

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

/**
 * Wrap an already-parsed value (e.g. a TS/JS config object loaded via jiti, or an
 * inline route/collection) as a {@link SourceDoc}. Line positions are unavailable,
 * so {@link SourceDoc.lineAt} returns `undefined`.
 */
export function inlineSourceDoc(file: string, data: unknown): SourceDoc {
  return { file, data, lineAt: () => undefined }
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
