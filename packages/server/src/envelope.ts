import type { IncomingMessage } from 'node:http'
import { buildEnvelope, normalizeHeaders, parseBody, type RequestEnvelope } from '@decoy/core'

/** Read the raw request body bytes, or `undefined` when the request carries no body. */
export async function readRawBody(req: IncomingMessage): Promise<Buffer | undefined> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(chunk as Buffer)
  }
  return chunks.length === 0 ? undefined : Buffer.concat(chunks)
}

/**
 * Build the documented request envelope from a Node request and its already-read raw
 * body. Unlike the in-process adapters, the server sources the body itself —
 * decoding the raw bytes and JSON-parsing them by content type via the shared core
 * normalizer.
 */
export function envelopeFrom(req: IncomingMessage, rawBody: Buffer | undefined): RequestEnvelope {
  const headers = normalizeHeaders(req.headers)
  return buildEnvelope({
    method: req.method ?? 'GET',
    url: req.url ?? '/',
    headers,
    body: parseBody(rawBody?.toString('utf8'), headers['content-type'] ?? ''),
  })
}

/** Build the documented request envelope from a Node request, reading its body first. */
export async function toEnvelope(req: IncomingMessage): Promise<RequestEnvelope> {
  return envelopeFrom(req, await readRawBody(req))
}
