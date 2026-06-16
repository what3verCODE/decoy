import {
  compile as compileJmespath,
  type JSONValue,
  TreeInterpreter,
} from '@jmespath-community/jmespath'

/**
 * A pre-compiled renderer: maps a request envelope to the rendered value. Every
 * `${ }` expression it contains is parsed **once** at compile time, so rendering
 * does no per-request compilation (ADR-0009). The envelope is `unknown` because
 * its `body` is opaque (the contract shape, not strict JSON).
 */
export type Renderer = (env: unknown) => unknown

/** A pre-parsed JMESPath expression (the same AST the engine's predicates use). */
type CompiledExpr = ReturnType<typeof compileJmespath>

/**
 * Scan a string into literal/expression segments. `${ <jmespath> }` opens an
 * expression; the matching `}` is found by **brace balancing**, so an expression
 * containing braces (a multiselect-hash like `${ map(&{id: @}, range(\`1\`,\`3\`)) }`)
 * is captured whole. `\${` is an **escape**: it emits a literal `${` and the
 * backslash is consumed. An unterminated `${` is treated as literal text (render
 * never throws; load-time validation flags the malformed expression).
 *
 * `onExpr` is invoked with each expression's trimmed source, returning whatever
 * the caller wants stored for that segment — the renderer compiles it, the
 * validator collects the source string.
 */
function scan<T>(
  source: string,
  onExpr: (exprSource: string) => T,
): Array<{ literal: string } | { value: T }> {
  const segments: Array<{ literal: string } | { value: T }> = []
  let literal = ''
  const flush = () => {
    if (literal.length > 0) {
      segments.push({ literal })
      literal = ''
    }
  }
  let i = 0
  while (i < source.length) {
    if (source[i] === '\\' && source[i + 1] === '$' && source[i + 2] === '{') {
      literal += '${'
      i += 3
      continue
    }
    if (source[i] === '$' && source[i + 1] === '{') {
      let depth = 1
      let j = i + 2
      for (; j < source.length; j++) {
        if (source[j] === '{') {
          depth++
        } else if (source[j] === '}') {
          depth--
          if (depth === 0) {
            break
          }
        }
      }
      if (depth !== 0) {
        // Unterminated `${` — keep the remainder as literal text and stop.
        literal += source.slice(i)
        i = source.length
        break
      }
      flush()
      segments.push({ value: onExpr(source.slice(i + 2, j).trim()) })
      i = j + 1
      continue
    }
    literal += source[i]
    i++
  }
  flush()
  if (segments.length === 0) {
    segments.push({ literal: '' })
  }
  return segments
}

/** Coerce an evaluated value to its string form for embedded interpolation. */
function stringify(value: unknown): string {
  if (value === null || value === undefined) {
    return ''
  }
  if (typeof value === 'string') {
    return value
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return JSON.stringify(value)
}

/** Evaluate a compiled expression against the envelope; a missing path is `null`, never `undefined`. */
function search(expr: CompiledExpr, env: unknown): unknown {
  const result = TreeInterpreter.search(expr, env as JSONValue)
  return result === undefined ? null : result
}

/**
 * Compile a single string. A string that is **entirely** one `${ expr }` renders
 * to the raw evaluated value (type preserved); an **embedded** expression (with
 * surrounding text or another expression) interpolates as a string; a string with
 * no expression renders to itself (the fast path — no per-request work).
 */
function compileString(source: string): Renderer {
  const segments = scan(source, (exprSource) => compileJmespath(exprSource))
  if (segments.length === 1) {
    const only = segments[0] as { literal: string } | { value: CompiledExpr }
    if ('literal' in only) {
      const literal = only.literal
      return () => literal
    }
    const expr = only.value
    return (envelope) => search(expr, envelope)
  }
  return (envelope) =>
    segments
      .map((segment) =>
        'literal' in segment ? segment.literal : stringify(search(segment.value, envelope)),
      )
      .join('')
}

/**
 * Compile any JSON value into a {@link Renderer}, applying `${ }` templating
 * **deeply** to every string leaf of objects and arrays. **Keys are never
 * templated.** Non-string leaves (number/boolean/null) pass through untouched.
 * Compilation parses every embedded expression up front (it throws on a malformed
 * expression — the engine's fail-fast backstop; validation catches it earlier with
 * `file:line`).
 */
export function compileTemplate(value: unknown): Renderer {
  if (typeof value === 'string') {
    return compileString(value)
  }
  if (Array.isArray(value)) {
    const items = value.map((item) => compileTemplate(item))
    return (envelope) => items.map((render) => render(envelope))
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).map(
      ([key, child]) => [key, compileTemplate(child)] as const,
    )
    return (envelope) => {
      const out: Record<string, unknown> = {}
      for (const [key, render] of entries) {
        out[key] = render(envelope)
      }
      return out
    }
  }
  return () => value
}

/** Extract the trimmed source of every `${ }` expression in a string (for load-time validation). */
export function scanTemplateExpressions(source: string): string[] {
  const expressions: string[] = []
  scan(source, (exprSource) => {
    expressions.push(exprSource)
    return exprSource
  })
  return expressions
}

/**
 * Whether any string leaf of `value` carries a `${ }` delimiter (including the
 * `\${` escape, which still needs de-escaping). Lets a caller skip rendering a
 * value with no templates and serve it verbatim — the no-template fast path.
 */
export function hasTemplates(value: unknown): boolean {
  if (typeof value === 'string') {
    return value.includes('${')
  }
  if (Array.isArray(value)) {
    return value.some(hasTemplates)
  }
  if (value !== null && typeof value === 'object') {
    return Object.values(value).some(hasTemplates)
  }
  return false
}
