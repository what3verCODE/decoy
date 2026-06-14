import type { IncomingMessage } from 'node:http'
import type { RequestEnvelope } from '@decoy/core'

function normalizeHeaders(raw: IncomingMessage['headers']): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) {
      continue
    }
    headers[key] = Array.isArray(value) ? value.join(', ') : value
  }
  return headers
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {}
  if (!cookieHeader) {
    return cookies
  }
  for (const pair of cookieHeader.split(';')) {
    const index = pair.indexOf('=')
    if (index === -1) {
      continue
    }
    const name = pair.slice(0, index).trim()
    if (name) {
      cookies[name] = decodeURIComponent(pair.slice(index + 1).trim())
    }
  }
  return cookies
}

function queryToObject(params: URLSearchParams): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = {}
  for (const key of new Set(params.keys())) {
    const all = params.getAll(key)
    query[key] = all.length > 1 ? all : (all[0] ?? '')
  }
  return query
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(chunk as Buffer)
  }
  if (chunks.length === 0) {
    return undefined
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  const contentType = req.headers['content-type'] ?? ''
  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(raw)
    } catch {
      return raw
    }
  }
  return raw
}

/** Build the documented request envelope from a Node request. */
export async function toEnvelope(req: IncomingMessage): Promise<RequestEnvelope> {
  const rawUrl = req.url ?? '/'
  const url = new URL(rawUrl, 'http://localhost')
  const headers = normalizeHeaders(req.headers)

  return {
    method: req.method ?? 'GET',
    url: rawUrl,
    path: decodeURIComponent(url.pathname),
    pathParams: {},
    query: queryToObject(url.searchParams),
    headers,
    cookies: parseCookies(headers.cookie),
    body: await readBody(req),
  }
}
