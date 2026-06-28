import {
  buildEnvelope,
  type Collection,
  createController,
  type Definitions,
  planResponse,
  type ResponsePlan,
  type Route,
  type TraceStep,
} from '@decoy/core'
import { parse as parseYaml } from 'yaml'

/**
 * The single document the editor holds: route definitions, the active scenario, and a
 * request to try. The active scenario is a minimal `collection` array of
 * `route:preset:variant` strings — a decoy collection's routes list — so switching a
 * variant is a one-line edit (`:ada` → `:boom`). `collection` is optional: omit it and
 * each route's first variant is served. (`collections` + `defaultCollection`, the full
 * decoy form, are also accepted.)
 */
interface PlaygroundDoc {
  routes?: Route[]
  /** The active scenario, minimal: a list of `route:preset:variant` activations. */
  collection?: string[]
  collections?: Collection[]
  defaultCollection?: string
  missStatus?: number
  request?: {
    method?: string
    path?: string
    headers?: Record<string, string>
    body?: unknown
  }
}

export interface RunOk {
  ok: true
  resolution: string
  plan: ResponsePlan
  steps: TraceStep[]
}
export interface RunErr {
  ok: false
  error: string
}
export type RunResult = RunOk | RunErr

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Parse the editor text. JSON is a subset of YAML, so one parser handles both formats. */
function parseDoc(text: string): PlaygroundDoc | { error: string } {
  if (!text.trim()) {
    return { error: 'editor is empty' }
  }
  try {
    const parsed = parseYaml(text) as unknown
    if (parsed === null || typeof parsed !== 'object') {
      return { error: 'top level must be an object with routes, collections, and a request' }
    }
    return parsed as PlaygroundDoc
  } catch (error) {
    return { error: `parse — ${messageOf(error)}` }
  }
}

/**
 * Resolve the editor's request against its mock with the **real** engine, returning the
 * serialized response plan plus the engine's step-by-step trace — or a human error.
 */
export function run(text: string): RunResult {
  const doc = parseDoc(text)
  if ('error' in doc) {
    return { ok: false, error: doc.error }
  }

  const routes = doc.routes ?? []
  if (routes.length === 0) {
    return { ok: false, error: 'no routes defined' }
  }

  // Resolve the active scenario, in precedence order:
  //  1. the minimal `collection` array (a collection's routes list) — the common form;
  //  2. an explicit `collections` + `defaultCollection` (full decoy form);
  //  3. neither → synthesize, activating each route's first preset + first variant.
  let collections = doc.collections ?? []
  let defaultCollection = doc.defaultCollection
  if (doc.collection) {
    collections = [{ id: 'playground', routes: doc.collection }]
    defaultCollection = 'playground'
  } else if (collections.length === 0) {
    const entries: string[] = []
    for (const route of routes) {
      const preset = Object.keys(route.presets ?? {})[0]
      const variant = Object.keys(route.variants ?? {})[0]
      if (preset && variant) {
        entries.push(`${route.id}:${preset}:${variant}`)
      }
    }
    collections = [{ id: 'playground', routes: entries }]
    defaultCollection = 'playground'
  }
  defaultCollection = defaultCollection ?? collections[0]?.id
  if (!defaultCollection) {
    return { ok: false, error: 'no defaultCollection and the first collection has no id' }
  }

  const definitions: Definitions = {
    routes: new Map(routes.map((route) => [route.id, route])),
    collections: new Map(collections.map((collection) => [collection.id, collection])),
  }

  const request = doc.request ?? {}
  try {
    const controller = createController(definitions, defaultCollection)
    const envelope = buildEnvelope({
      method: (request.method ?? 'GET').toUpperCase(),
      url: request.path ?? '/',
      headers:
        request.headers ??
        (request.body === undefined ? {} : { 'content-type': 'application/json' }),
      body: request.body,
    })
    const { steps, result } = controller.explain(envelope)
    const plan = planResponse(result, doc.missStatus ?? 501)
    const resolution =
      result.type === 'matched'
        ? `${result.address.route}:${result.address.preset}:${result.address.variant}`
        : `MISS(${result.reason.kind})`
    return { ok: true, resolution, plan, steps }
  } catch (error) {
    return { ok: false, error: messageOf(error) }
  }
}

/** The starter document — route defs, a minimal active collection, and a request. */
export const EXAMPLE = `# Author the routes, pick the active variant in 'collection'
# (edit :ada -> :boom to switch), then a request to try.
routes:
  - id: users-by-id
    method: GET
    path: /users/{id}
    presets:
      default: {}
    variants:
      ada:
        status: 200
        body: { id: 42, name: Ada, greeting: "Hi \${ pathParams.id }" }
      boom:
        status: 500
        body: { error: upstream exploded }

collection:
  - users-by-id:default:ada

request:
  method: GET
  path: /users/42
`
