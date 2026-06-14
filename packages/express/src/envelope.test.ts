import { describe, expect, test } from '@rstest/core'
import { toEnvelope } from './envelope'
import type { ExpressRequest } from './express-types'

function req(init: Partial<ExpressRequest>): ExpressRequest {
  return {
    method: init.method ?? 'GET',
    originalUrl: init.originalUrl,
    url: init.url,
    headers: init.headers ?? {},
    body: init.body,
  }
}

describe('toEnvelope', () => {
  test('splits path and query from the URL, leaving pathParams to the engine', () => {
    const envelope = toEnvelope(req({ originalUrl: '/users/42?expand=true' }))
    expect(envelope.method).toBe('GET')
    expect(envelope.path).toBe('/users/42')
    expect(envelope.url).toBe('/users/42?expand=true')
    expect(envelope.query).toEqual({ expand: 'true' })
    expect(envelope.pathParams).toEqual({})
  })

  test('repeated query keys become arrays; single keys stay scalar', () => {
    const envelope = toEnvelope(req({ originalUrl: '/search?tag=a&tag=b&q=x' }))
    expect(envelope.query).toEqual({ tag: ['a', 'b'], q: 'x' })
  })

  test('decodes a percent-encoded path', () => {
    const envelope = toEnvelope(req({ originalUrl: '/users/a%20b' }))
    expect(envelope.path).toBe('/users/a b')
  })

  test('falls back to req.url when originalUrl is absent', () => {
    const envelope = toEnvelope(req({ originalUrl: undefined, url: '/fallback?z=1' }))
    expect(envelope.path).toBe('/fallback')
    expect(envelope.query).toEqual({ z: '1' })
  })

  test('normalizes headers (array values joined) and is case-preserving', () => {
    const envelope = toEnvelope(
      req({ headers: { 'x-trace': ['a', 'b'], 'content-type': 'application/json' } }),
    )
    expect(envelope.headers['x-trace']).toBe('a, b')
    expect(envelope.headers['content-type']).toBe('application/json')
  })

  test('parses cookies from the Cookie header', () => {
    const envelope = toEnvelope(req({ headers: { cookie: 'sid=abc; theme=dark' } }))
    expect(envelope.cookies).toEqual({ sid: 'abc', theme: 'dark' })
  })

  test('takes the already-parsed body from req.body verbatim', () => {
    const body = { id: 7 }
    const envelope = toEnvelope(req({ method: 'POST', originalUrl: '/users', body }))
    expect(envelope.body).toBe(body)
  })

  test('body is undefined when no body parser populated req.body', () => {
    const envelope = toEnvelope(req({ method: 'POST', originalUrl: '/users' }))
    expect(envelope.body).toBeUndefined()
  })
})
