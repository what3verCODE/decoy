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

/** The single document the editor holds: a Decoy mock (routes + collections) plus a request to try. */
interface PlaygroundDoc {
  routes?: Route[]
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
  const collections = doc.collections ?? []
  if (routes.length === 0) {
    return { ok: false, error: 'no routes defined' }
  }
  if (collections.length === 0) {
    return { ok: false, error: 'no collections defined' }
  }
  const defaultCollection = doc.defaultCollection ?? collections[0]?.id
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

/** The starter document — a mock with a templated variant and a request that matches it. */
export const EXAMPLE = `# Author a Decoy mock (routes + collections), then a request to try.
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

collections:
  - id: happy-path
    routes: [users-by-id:default:ada]

defaultCollection: happy-path

request:
  method: GET
  path: /users/42
`
