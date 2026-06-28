import { describe, expect, test } from '@rstest/core'
import { buildEnvelope, normalizeHeaders, parseBody } from './envelope'

describe('buildEnvelope', () => {
  test('splits a relative URL into path and query (repeated keys become arrays)', () => {
    const envelope = buildEnvelope({
      method: 'GET',
      url: '/users?page=2&tag=a&tag=b',
      headers: {},
      body: undefined,
    })

    expect(envelope.method).toBe('GET')
    expect(envelope.url).toBe('/users?page=2&tag=a&tag=b')
    expect(envelope.path).toBe('/users')
    expect(envelope.query).toEqual({ page: '2', tag: ['a', 'b'] })
    expect(envelope.params).toEqual({})
  })

  test('parses an absolute URL the same way (base is ignored)', () => {
    const relative = buildEnvelope({ method: 'GET', url: '/x?a=1', headers: {}, body: undefined })
    const absolute = buildEnvelope({
      method: 'GET',
      url: 'http://example.test:4001/x?a=1',
      headers: {},
      body: undefined,
    })

    expect(absolute.path).toBe(relative.path)
    expect(absolute.query).toEqual(relative.query)
  })

  test('decodes a percent-encoded path', () => {
    const envelope = buildEnvelope({
      method: 'GET',
      url: '/users/a%20b',
      headers: {},
      body: undefined,
    })

    expect(envelope.path).toBe('/users/a b')
  })

  test('parses cookies from the Cookie header (values URI-decoded)', () => {
    const envelope = buildEnvelope({
      method: 'GET',
      url: '/x',
      headers: { cookie: 'sid=abc; theme=dark%20mode' },
      body: undefined,
    })

    expect(envelope.cookies).toEqual({ sid: 'abc', theme: 'dark mode' })
  })

  test('carries the body and headers through verbatim', () => {
    const body = { already: 'parsed' }
    const envelope = buildEnvelope({
      method: 'POST',
      url: '/x',
      headers: { 'content-type': 'application/json' },
      body,
    })

    expect(envelope.body).toBe(body)
    expect(envelope.headers).toEqual({ 'content-type': 'application/json' })
  })
})

describe('normalizeHeaders', () => {
  test('drops undefined values and joins array values', () => {
    expect(
      normalizeHeaders({
        'x-single': 'one',
        'x-multi': ['a', 'b'],
        'x-absent': undefined,
      }),
    ).toEqual({ 'x-single': 'one', 'x-multi': 'a, b' })
  })
})

describe('parseBody', () => {
  test('returns undefined for an absent body', () => {
    expect(parseBody(undefined, 'application/json')).toBeUndefined()
  })

  test('parses JSON when the content type says so', () => {
    expect(parseBody('{"a":1}', 'application/json; charset=utf-8')).toEqual({ a: 1 })
  })

  test('falls back to raw text when JSON is malformed', () => {
    expect(parseBody('{nope', 'application/json')).toBe('{nope')
  })

  test('keeps a non-JSON body as raw text', () => {
    expect(parseBody('hello', 'text/plain')).toBe('hello')
  })
})
