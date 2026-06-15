import * as v from 'valibot'
import type { LineAt } from './source'
import type { ValidationIssue } from './validate'

/** Standard HTTP methods a route may declare (matched case-insensitively). */
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const

const StringRecord = v.record(v.string(), v.string())

/** One response: status/headers/delay/body (all optional; body is opaque). */
export const VariantSchema = v.object({
  status: v.optional(v.pipe(v.number(), v.integer())),
  headers: v.optional(StringRecord),
  delay: v.optional(v.pipe(v.number(), v.minValue(0))),
  body: v.optional(v.unknown()),
})

/** Additional request-match conditions layered on a route. */
export const PresetSchema = v.object({
  query: v.optional(StringRecord),
  headers: v.optional(StringRecord),
  body: v.optional(v.unknown()),
  match: v.optional(v.string()),
})

/** The coarse matcher + namespace: id + method + path, with presets and variants. */
export const RouteSchema = v.object({
  id: v.pipe(v.string(), v.nonEmpty('route id must not be empty')),
  method: v.pipe(
    v.string(),
    v.transform((s) => s.toUpperCase()),
    v.picklist(HTTP_METHODS, `method must be one of ${HTTP_METHODS.join(', ')}`),
  ),
  path: v.pipe(v.string(), v.startsWith('/', 'path must start with "/"')),
  presets: v.record(v.string(), PresetSchema),
  variants: v.record(v.string(), VariantSchema),
})

/** An ordered list of `route:preset:variant` activations; `extends` inherits another. */
export const CollectionSchema = v.object({
  id: v.pipe(v.string(), v.nonEmpty('collection id must not be empty')),
  extends: v.optional(v.string()),
  routes: v.array(v.string()),
})

const AdminSchema = v.union([
  v.boolean(),
  v.object({ port: v.optional(v.number()), prefix: v.optional(v.string()) }),
])

/** Global passthrough target (ADR-0005): a single upstream base URL. */
const PassthroughSchema = v.object({
  url: v.pipe(
    v.string(),
    v.nonEmpty('passthrough.url must not be empty'),
    v.url('passthrough.url must be a valid URL'),
  ),
})

/** One service entry of a Decoy config. */
export const ServiceConfigSchema = v.object({
  name: v.optional(v.string()),
  port: v.optional(v.number()),
  admin: v.optional(AdminSchema),
  missStatus: v.optional(
    v.pipe(
      v.number(),
      v.integer('missStatus must be an integer'),
      v.minValue(100, 'missStatus must be a valid HTTP status code (100-599)'),
      v.maxValue(599, 'missStatus must be a valid HTTP status code (100-599)'),
    ),
  ),
  passthrough: v.optional(PassthroughSchema),
  sessionIdleTtl: v.optional(
    v.pipe(
      v.number(),
      v.integer('sessionIdleTtl must be an integer (ms)'),
      v.minValue(1, 'sessionIdleTtl must be a positive number of ms'),
    ),
  ),
  routesDir: v.optional(v.string()),
  collectionsFile: v.optional(v.string()),
  defaultCollection: v.optional(v.string()),
  routes: v.optional(v.array(RouteSchema)),
  collections: v.optional(v.array(CollectionSchema)),
})

/** Render a valibot issue path (`['presets','with-query','query']`) as a dotted string. */
function dottedPath(issue: v.BaseIssue<unknown>): string {
  const path = issue.path ?? []
  return path.map((segment) => String((segment as { key: unknown }).key)).join('.')
}

/**
 * Schema-validate a service config object against {@link ServiceConfigSchema},
 * mapping every valibot issue to a **service-scoped** {@link ValidationIssue}:
 * `error in <service>: <message> at <value.path>` (the ` at <path>` is omitted for
 * a root-level issue). Unlike mock files, the config file carries no `file:line` —
 * its discovery/loading is owned by cosmiconfig — so issues are located by the
 * service identifier (`service "name"`, `service [index]`, or `service`) and the
 * offending value path instead. `file` is still the resolved config file path.
 */
export function validateServiceConfig(
  data: unknown,
  file: string,
  service: string,
): ValidationIssue[] {
  const result = v.safeParse(ServiceConfigSchema, data, { abortPipeEarly: false })
  if (result.success) {
    return []
  }
  return result.issues.map((issue) => {
    const dotted = dottedPath(issue)
    return {
      severity: 'error' as const,
      message: `error in ${service}: ${issue.message}${dotted ? ` at ${dotted}` : ''}`,
      file,
    }
  })
}

/**
 * Schema-validate `data` against `schema`, mapping every valibot issue to a
 * {@link ValidationIssue} with the offending field's `file:line`. The line is the
 * field path's own line when resolvable, falling back to the document root.
 */
export function validateWithSchema(
  schema: v.GenericSchema,
  data: unknown,
  file: string,
  lineAt: LineAt,
): ValidationIssue[] {
  const result = v.safeParse(schema, data, { abortPipeEarly: false })
  if (result.success) {
    return []
  }
  return result.issues.map((issue) => {
    const path = (issue.path ?? []).map((segment) => (segment as { key: string | number }).key)
    const dotted = dottedPath(issue)
    return {
      severity: 'error' as const,
      message: dotted ? `${dotted}: ${issue.message}` : issue.message,
      file,
      line: lineAt(path) ?? lineAt([]),
    }
  })
}
