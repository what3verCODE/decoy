import { describe, expect, test } from '@rstest/core'
import {
  forwardPassthrough,
  type PassthroughRequest,
  type PassthroughResponse,
} from './passthrough'

function fakeResponse(): PassthroughResponse & { headers: Record<string, string>; body?: Buffer } {
  const headers: Record<string, string> = {}
  return {
    statusCode: 0,
    headers,
    setHeader(name, value) {
      headers[name] = value
    },
    end(chunk) {
      this.body = chunk
    },
  }
}

/** Records the URL + init it was called with and returns a canned upstream response. */
function fetchStub(
  upstream: { status: number; headers?: Record<string, string>; body?: string },
  calls: Array<{ url: string; init: RequestInit }>,
): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    return new Response(upstream.body ?? '', {
      status: upstream.status,
      headers: upstream.headers ?? {},
    })
  }) as unknown as typeof fetch
}

describe('forwardPassthrough', () => {
  test('forwards method, path+query, and body to {target}{url}; returns the upstream verbatim', async () => {
    const req: PassthroughRequest = {
      method: 'POST',
      url: '/users?page=2',
      headers: { 'content-type': 'application/json', host: 'localhost:4000' },
    }
    const res = fakeResponse()
    const calls: Array<{ url: string; init: RequestInit }> = []
    const fetchImpl = fetchStub(
      { status: 201, headers: { 'content-type': 'application/json' }, body: '{"ok":true}' },
      calls,
    )

    const status = await forwardPassthrough(
      req,
      res,
      Buffer.from('{"name":"Ada"}'),
      'https://users.real',
      fetchImpl,
    )

    expect(status).toBe(201)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://users.real/users?page=2')
    expect(calls[0]?.init.method).toBe('POST')
    expect(res.statusCode).toBe(201)
    expect(res.headers['content-type']).toBe('application/json')
    expect(res.body?.toString('utf8')).toBe('{"ok":true}')
  })

  test('strips hop-by-hop and host/content-length request headers', async () => {
    const req: PassthroughRequest = {
      method: 'GET',
      url: '/x',
      headers: {
        host: 'localhost:4000',
        connection: 'keep-alive',
        'content-length': '14',
        authorization: 'Bearer t',
        'x-custom': 'keep-me',
      },
    }
    const calls: Array<{ url: string; init: RequestInit }> = []
    await forwardPassthrough(
      req,
      fakeResponse(),
      undefined,
      'https://up',
      fetchStub({ status: 200 }, calls),
    )

    const sent = calls[0]?.init.headers as Record<string, string>
    expect(sent.host).toBeUndefined()
    expect(sent.connection).toBeUndefined()
    expect(sent['content-length']).toBeUndefined()
    expect(sent.authorization).toBe('Bearer t')
    expect(sent['x-custom']).toBe('keep-me')
  })

  test('does not send a body for GET even when one was buffered', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    await forwardPassthrough(
      { method: 'GET', url: '/x', headers: {} },
      fakeResponse(),
      Buffer.from('ignored'),
      'https://up',
      fetchStub({ status: 200 }, calls),
    )
    expect(calls[0]?.init.body).toBeUndefined()
  })

  test('drops content-encoding/length from the response so decoded bytes are sent honestly', async () => {
    const res = fakeResponse()
    await forwardPassthrough(
      { method: 'GET', url: '/x', headers: {} },
      res,
      undefined,
      'https://up',
      fetchStub(
        {
          status: 200,
          headers: { 'content-encoding': 'gzip', 'content-length': '999', etag: 'W/"1"' },
        },
        [],
      ),
    )
    expect(res.headers['content-encoding']).toBeUndefined()
    expect(res.headers['content-length']).toBeUndefined()
    expect(res.headers.etag).toBe('W/"1"')
  })
})
