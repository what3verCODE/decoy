import { builtinModules } from 'node:module'
import ts from 'typescript'

/** A forbidden module import found in `@decoy/core` source. */
export type Impurity = {
  file: string
  line: number
  specifier: string
}

/** A module specifier referenced by a source file, with its 1-based line. */
export type ModuleRef = {
  specifier: string
  line: number
}

/** A source file to scan (path + contents) — kept separate from IO so detection stays pure. */
export type SourceFile = {
  file: string
  content: string
}

const BUILTIN_MODULES = new Set(builtinModules)

/**
 * Whether `specifier` resolves to a Node.js built-in — the IO surface a pure
 * engine must never reach. Matches `node:`-prefixed specifiers, bare builtin
 * names, and builtin subpaths (`fs/promises`, `stream/web`, …).
 */
export function isNodeBuiltin(specifier: string): boolean {
  if (specifier.startsWith('node:')) return true
  if (BUILTIN_MODULES.has(specifier)) return true
  const root = specifier.split('/')[0]
  return root !== undefined && BUILTIN_MODULES.has(root)
}

/**
 * Every module specifier referenced by `content`, in source order: static
 * `import`/`export … from`, `import x = require(...)`, dynamic `import()`, and
 * CommonJS `require()`. Parsed with the TypeScript compiler so string-in-source
 * false positives (comments, identifiers) can't slip through.
 */
export function extractModuleSpecifiers(content: string): ModuleRef[] {
  const source = ts.createSourceFile('module.ts', content, ts.ScriptTarget.Latest, true)
  const refs: ModuleRef[] = []

  const record = (node: ts.Node, specifier: string): void => {
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source))
    refs.push({ specifier, line: line + 1 })
  }

  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      record(node.moduleSpecifier, node.moduleSpecifier.text)
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      record(node.moduleReference.expression, node.moduleReference.expression.text)
    } else if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require'
      const arg = node.arguments[0]
      if ((isDynamicImport || isRequire) && arg && ts.isStringLiteral(arg)) {
        record(arg, arg.text)
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(source)
  return refs
}

/** Node-built-in imports in one source file, as `Impurity` records. */
export function scanSource(file: string, content: string): Impurity[] {
  return extractModuleSpecifiers(content)
    .filter((ref) => isNodeBuiltin(ref.specifier))
    .map((ref) => ({ file, line: ref.line, specifier: ref.specifier }))
}

/** Aggregate all impurities across a set of source files, in file/source order. */
export function findImpurities(files: SourceFile[]): Impurity[] {
  return files.flatMap((f) => scanSource(f.file, f.content))
}
