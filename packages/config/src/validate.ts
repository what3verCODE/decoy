import { compile as compileJmespath } from '@jmespath-community/jmespath'
import { CollectionSchema, RouteSchema, ServiceConfigSchema, validateWithSchema } from './schema'
import type { LineAt, ValuePath } from './source'

/** Severity of a validation issue: an `error` blocks boot; a `warning` does not. */
export type Severity = 'error' | 'warning'

/** A single validation finding, located at `file:line` (line omitted when unknown). */
export interface ValidationIssue {
  severity: Severity
  message: string
  file: string
  line?: number
}

/** A raw, line-aware route source (one route per file, or one inline config entry). */
export interface RawRoute {
  data: unknown
  file: string
  lineAt: LineAt
}

/** A raw, line-aware collection source. */
export interface RawCollection {
  data: unknown
  file: string
  lineAt: LineAt
}

/** Everything aggregate validation needs: the (optional) config plus every route/collection source. */
export interface ValidationInput {
  /** The resolved service config object, present only when a config file was loaded. */
  config?: { data: unknown; file: string; lineAt: LineAt }
  routes: RawRoute[]
  collections: RawCollection[]
}

type Json = Record<string, unknown>

function isRecord(value: unknown): value is Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** A defensive view of a raw route's addressable shape (post-schema, fields may still be absent). */
interface RouteView {
  id?: string
  method?: string
  path?: string
  presets: Json
  variants: Json
}

function asRouteView(data: unknown): RouteView | undefined {
  if (!isRecord(data)) {
    return undefined
  }
  return {
    id: typeof data.id === 'string' ? data.id : undefined,
    method: typeof data.method === 'string' ? data.method : undefined,
    path: typeof data.path === 'string' ? data.path : undefined,
    presets: isRecord(data.presets) ? data.presets : {},
    variants: isRecord(data.variants) ? data.variants : {},
  }
}

interface CollectionView {
  id?: string
  extends?: string
  routes: string[]
}

function asCollectionView(data: unknown): CollectionView | undefined {
  if (!isRecord(data)) {
    return undefined
  }
  return {
    id: typeof data.id === 'string' ? data.id : undefined,
    extends: typeof data.extends === 'string' ? data.extends : undefined,
    routes: Array.isArray(data.routes)
      ? data.routes.filter((r): r is string => typeof r === 'string')
      : [],
  }
}

function pathSegments(p: string): string[] {
  return p.split('/').filter((s) => s.length > 0)
}

function isParamSegment(segment: string): boolean {
  return /^\{.+\}$/.test(segment)
}

/**
 * Two paths overlap when they have the same segment count and every segment pair
 * is compatible: equal literals, or at least one side is a `{param}`. This flags
 * the genuinely ambiguous cases — `/users/me` vs `/users/{id}`, `/a/{x}` vs
 * `/a/{y}`, exact duplicates — without flagging unrelated paths.
 */
function pathsOverlap(a: string, b: string): boolean {
  const sa = pathSegments(a)
  const sb = pathSegments(b)
  if (sa.length !== sb.length) {
    return false
  }
  for (let i = 0; i < sa.length; i++) {
    const x = sa[i] as string
    const y = sb[i] as string
    if (isParamSegment(x) || isParamSegment(y)) {
      continue
    }
    if (x !== y) {
      return false
    }
  }
  return true
}

/** Extract the inner expressions of every `{{ ... }}` occurrence in a string. */
function extractTemplates(value: string): string[] {
  const expressions: string[] = []
  const re = /\{\{([\s\S]*?)\}\}/g
  let match: RegExpExecArray | null = re.exec(value)
  while (match !== null) {
    expressions.push((match[1] ?? '').trim())
    match = re.exec(value)
  }
  return expressions
}

/** Visit every string leaf of a value, reporting its path relative to the value root. */
function walkStrings(
  value: unknown,
  path: ValuePath,
  visit: (text: string, at: ValuePath) => void,
): void {
  if (typeof value === 'string') {
    visit(value, path)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      walkStrings(item, [...path, index], visit)
    })
    return
  }
  if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      walkStrings(child, [...path, key], visit)
    }
  }
}

/** Parse a JMESPath expression, returning a parse-error message or `undefined` if valid. */
function jmespathError(expression: string): string | undefined {
  try {
    compileJmespath(expression)
    return undefined
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

/**
 * Run the full load-time validation suite over the collected sources and return
 * **all** issues together (never bailing on the first): schema, cross-reference
 * of every `route:preset:variant` address, `extends` resolution and cycles,
 * duplicate route ids (error) and overlapping `method`+`path` (warning), and
 * JMESPath parse of every `match:` predicate and `{{ }}` template. Pure: it does
 * no IO, operating only on the already-read, line-aware sources.
 */
export function validateSources(input: ValidationInput): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  // 1. Schema validation — config, then every route and collection file.
  if (input.config) {
    issues.push(
      ...validateWithSchema(
        ServiceConfigSchema,
        input.config.data,
        input.config.file,
        input.config.lineAt,
      ),
    )
  }
  for (const route of input.routes) {
    issues.push(...validateWithSchema(RouteSchema, route.data, route.file, route.lineAt))
  }
  for (const collection of input.collections) {
    issues.push(
      ...validateWithSchema(CollectionSchema, collection.data, collection.file, collection.lineAt),
    )
  }

  // 2. Duplicate route ids — error on the second and later definition.
  const firstById = new Map<string, { file: string; line?: number }>()
  for (const route of input.routes) {
    const view = asRouteView(route.data)
    if (!view?.id) {
      continue
    }
    const prior = firstById.get(view.id)
    if (prior) {
      const where = prior.line !== undefined ? `${prior.file}:${prior.line}` : prior.file
      issues.push({
        severity: 'error',
        message: `duplicate route id "${view.id}" (first defined at ${where})`,
        file: route.file,
        line: route.lineAt(['id']) ?? route.lineAt([]),
      })
    } else {
      firstById.set(view.id, { file: route.file, line: route.lineAt(['id']) ?? route.lineAt([]) })
    }
  }

  // 3. Overlapping method+path — warning on each colliding pair.
  const located = input.routes
    .map((route) => ({ route, view: asRouteView(route.data) }))
    .filter((r): r is { route: RawRoute; view: RouteView } =>
      Boolean(r.view?.method && r.view?.path),
    )
  for (let j = 0; j < located.length; j++) {
    const later = located[j] as { route: RawRoute; view: RouteView }
    for (let i = 0; i < j; i++) {
      const earlier = located[i] as { route: RawRoute; view: RouteView }
      if (
        (earlier.view.method as string).toUpperCase() ===
          (later.view.method as string).toUpperCase() &&
        pathsOverlap(earlier.view.path as string, later.view.path as string)
      ) {
        issues.push({
          severity: 'warning',
          message: `route "${later.view.id ?? '?'}" (${later.view.method} ${later.view.path}) overlaps route "${earlier.view.id ?? '?'}" (${earlier.view.method} ${earlier.view.path})`,
          file: later.route.file,
          line: later.route.lineAt(['path']) ?? later.route.lineAt([]),
        })
      }
    }
  }

  // Build lookup maps (last definition wins, mirroring the loader) for cross-reference.
  const routeViews = new Map<string, RouteView>()
  for (const route of input.routes) {
    const view = asRouteView(route.data)
    if (view?.id) {
      routeViews.set(view.id, view)
    }
  }
  const collectionViews = new Map<string, CollectionView>()
  for (const collection of input.collections) {
    const view = asCollectionView(collection.data)
    if (view?.id) {
      collectionViews.set(view.id, view)
    }
  }

  // 4. `extends` resolution and cycle detection.
  for (const collection of input.collections) {
    const view = asCollectionView(collection.data)
    if (!view?.extends) {
      continue
    }
    if (!collectionViews.has(view.extends)) {
      issues.push({
        severity: 'error',
        message: `collection "${view.id ?? '?'}" extends undefined collection "${view.extends}"`,
        file: collection.file,
        line: collection.lineAt(['extends']) ?? collection.lineAt([]),
      })
      continue
    }
    // Walk the chain from this collection; a revisit is a cycle.
    const seen = new Set<string>()
    let cursor: string | undefined = view.id
    while (cursor !== undefined) {
      if (seen.has(cursor)) {
        issues.push({
          severity: 'error',
          message: `collection "${view.id ?? '?'}" has a cyclic "extends" chain`,
          file: collection.file,
          line: collection.lineAt(['extends']) ?? collection.lineAt([]),
        })
        break
      }
      seen.add(cursor)
      cursor = collectionViews.get(cursor)?.extends
    }
  }

  // 5. Cross-reference: every declared `route:preset:variant` address resolves.
  for (const collection of input.collections) {
    const view = asCollectionView(collection.data)
    if (!view) {
      continue
    }
    view.routes.forEach((entry, index) => {
      const line = collection.lineAt(['routes', index]) ?? collection.lineAt([])
      const parts = entry.split(':')
      if (parts.length !== 3 || parts.some((p) => p.length === 0)) {
        issues.push({
          severity: 'error',
          message: `collection "${view.id ?? '?'}" has malformed entry "${entry}" (expected "route:preset:variant")`,
          file: collection.file,
          line,
        })
        return
      }
      const [routeId, presetId, variantId] = parts as [string, string, string]
      const route = routeViews.get(routeId)
      if (!route) {
        issues.push({
          severity: 'error',
          message: `collection "${view.id ?? '?'}" references undefined route "${routeId}" in "${entry}"`,
          file: collection.file,
          line,
        })
        return
      }
      if (!Object.hasOwn(route.presets, presetId)) {
        issues.push({
          severity: 'error',
          message: `collection "${view.id ?? '?'}" references undefined preset "${presetId}" on route "${routeId}" in "${entry}"`,
          file: collection.file,
          line,
        })
      }
      if (!Object.hasOwn(route.variants, variantId)) {
        issues.push({
          severity: 'error',
          message: `collection "${view.id ?? '?'}" references undefined variant "${variantId}" on route "${routeId}" in "${entry}"`,
          file: collection.file,
          line,
        })
      }
    })
  }

  // 6. JMESPath parse — `match:` predicates and `{{ }}` templates in variants.
  for (const route of input.routes) {
    const view = asRouteView(route.data)
    if (!view) {
      continue
    }
    for (const [presetName, preset] of Object.entries(view.presets)) {
      const match = isRecord(preset) ? preset.match : undefined
      if (typeof match === 'string') {
        const error = jmespathError(match)
        if (error) {
          issues.push({
            severity: 'error',
            message: `invalid JMESPath in preset "${presetName}" match: ${error}`,
            file: route.file,
            line: route.lineAt(['presets', presetName, 'match']) ?? route.lineAt([]),
          })
        }
      }
    }
    for (const [variantName, variant] of Object.entries(view.variants)) {
      walkStrings(variant, ['variants', variantName], (text, at) => {
        for (const expression of extractTemplates(text)) {
          const error = jmespathError(expression)
          if (error) {
            issues.push({
              severity: 'error',
              message: `invalid JMESPath template "{{ ${expression} }}" in variant "${variantName}": ${error}`,
              file: route.file,
              line: route.lineAt(at) ?? route.lineAt([]),
            })
          }
        }
      })
    }
  }

  return sortIssues(issues)
}

/** Deterministic ordering: by file, then line, then errors before warnings, then message. */
function sortIssues(issues: ValidationIssue[]): ValidationIssue[] {
  return [...issues].sort((a, b) => {
    if (a.file !== b.file) {
      return a.file < b.file ? -1 : 1
    }
    const la = a.line ?? Number.POSITIVE_INFINITY
    const lb = b.line ?? Number.POSITIVE_INFINITY
    if (la !== lb) {
      return la - lb
    }
    if (a.severity !== b.severity) {
      return a.severity === 'error' ? -1 : 1
    }
    return a.message < b.message ? -1 : a.message > b.message ? 1 : 0
  })
}

/** True if any issue is an error (errors block boot; warnings do not). */
export function hasErrors(issues: ValidationIssue[]): boolean {
  return issues.some((issue) => issue.severity === 'error')
}

/** Render issues as one `severity: file:line — message` line each. */
export function formatIssues(issues: ValidationIssue[]): string {
  return issues
    .map((issue) => {
      const where = issue.line !== undefined ? `${issue.file}:${issue.line}` : issue.file
      return `${issue.severity}: ${where} — ${issue.message}`
    })
    .join('\n')
}

/** Thrown by `loadConfig` when validation finds one or more errors; carries every issue. */
export class ValidationError extends Error {
  readonly issues: ValidationIssue[]

  constructor(issues: ValidationIssue[]) {
    super(`decoy config validation failed:\n${formatIssues(issues)}`)
    this.name = 'ValidationError'
    this.issues = issues
  }
}
