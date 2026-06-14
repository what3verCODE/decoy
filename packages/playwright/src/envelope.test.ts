import { describe, expect, test } from '@rstest/core'
import { toEnvelope } from './envelope'
import type { PlaywrightRequest } from './playwright-types'

/** A minimal fake Playwright `Request`. */
function fakeRequest(init: {
  method?: string
  url: string
  headers?: Record<string, string>
  postData?: string | null
}): PlaywrightRequest {
  return {
    method: () => init.method ?? 'GET',
    url: () => init.url,
    headers: () => init.headers ?? {},
    postData: () => init.postData ?? null,
  }
}

describe('toEnvelope', () => {
  test('splits the URL into path and query (repeated keys become arrays)', () => {
    const envelope = toEnvelope(
      fakeRequest({ url: 'http://localhost:4001/users?page=2&tag=a&tag=b' }),
    )

    expect(envelope.method).toBe('GET')
    expect(envelope.path).toBe('/users')
    expect(envelope.query).toEqual({ page: '2', tag: ['a', 'b'] })
  })

  test('parses cookies from the Cookie header', () => {
    const envelope = toEnvelope(
      fakeRequest({ url: 'http://localhost/x', headers: { cookie: 'sid=abc; theme=dark' } }),
    )

    expect(envelope.cookies).toEqual({ sid: 'abc', theme: 'dark' })
    expect(envelope.headers.cookie).toBe('sid=abc; theme=dark')
  })

  test('parses a JSON body when content-type is application/json', () => {
    const envelope = toEnvelope(
      fakeRequest({
        method: 'POST',
        url: 'http://localhost/orders',
        headers: { 'content-type': 'application/json' },
        postData: '{"item":"book","qty":2}',
      }),
    )

    expect(envelope.method).toBe('POST')
    expect(envelope.body).toEqual({ item: 'book', qty: 2 })
  })

  test('keeps a non-JSON body as a raw string and no body as undefined', () => {
    expect(
      toEnvelope(fakeRequest({ method: 'POST', url: 'http://localhost/x', postData: 'raw text' }))
        .body,
    ).toBe('raw text')

    expect(toEnvelope(fakeRequest({ url: 'http://localhost/x' })).body).toBeUndefined()
  })
})
