/**
 * Global passthrough (ADR-0005, DESIGN §6): forward an **unmatched** request
 * verbatim to one configured upstream and write its response back as-is. Off by
 * default — wired in only when the loaded service declares a passthrough target.
 */

/** The slice of a Node request passthrough needs (structural, so fakes fit in tests). */
export interface PassthroughRequest {
  method?: string
  url?: string
  headers: Record<string, string | string[] | undefined>
}

/** The slice of a Node response passthrough writes to (structural, so fakes fit in tests). */
export interface PassthroughResponse {
  statusCode: number
  setHeader(name: string, value: string): void
  end(chunk?: Buffer): void
}

/**
 * Hop-by-hop request headers (RFC 7230 §6.1) plus `host`/`content-length`, which
 * the upstream `fetch` derives from the new connection and body. Everything else
 * is forwarded unchanged.
 */
const STRIPPED_REQUEST_HEADERS = new Set([
  'host',
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'content-length',
])

/**
 * Response headers not safe to copy verbatim: hop-by-hop, plus `content-encoding`
 * and `content-length` — `fetch` decodes the body, so the original encoding/length
 * would mislead the client. Node recomputes the length of the bytes we write.
 */
const STRIPPED_RESPONSE_HEADERS = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'content-encoding',
  'content-length',
])

function forwardableHeaders(headers: PassthroughRequest['headers']): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined || STRIPPED_REQUEST_HEADERS.has(key.toLowerCase())) {
      continue
    }
    out[key] = Array.isArray(value) ? value.join(', ') : value
  }
  return out
}

/**
 * Forward `req` (with its already-read `rawBody`) to `{target}{url}` verbatim and
 * write the upstream response back onto `res`. Returns the upstream status (for
 * the per-request `PASSTHROUGH(target)` log line). `fetchImpl` is injectable for
 * tests; it defaults to the global `fetch`.
 */
export async function forwardPassthrough(
  req: PassthroughRequest,
  res: PassthroughResponse,
  rawBody: Buffer | undefined,
  target: string,
  fetchImpl: typeof fetch = fetch,
): Promise<number> {
  const method = req.method ?? 'GET'
  const url = `${target}${req.url ?? '/'}`
  const hasBody = method !== 'GET' && method !== 'HEAD' && rawBody !== undefined

  const upstream = await fetchImpl(url, {
    method,
    headers: forwardableHeaders(req.headers),
    body: hasBody ? new Uint8Array(rawBody) : undefined,
  })

  res.statusCode = upstream.status
  upstream.headers.forEach((value, key) => {
    if (!STRIPPED_RESPONSE_HEADERS.has(key.toLowerCase())) {
      res.setHeader(key, value)
    }
  })
  res.end(Buffer.from(await upstream.arrayBuffer()))
  return upstream.status
}
