import { describe, expect, test } from '@rstest/core'
import { buildResponse } from './response'

describe('buildResponse', () => {
  test('defaults status to 200', () => {
    expect(buildResponse({ body: 'ok' }).status).toBe(200)
  })

  test('keeps an explicit status', () => {
    expect(buildResponse({ status: 404, body: { message: 'nope' } }).status).toBe(404)
  })

  test('infers application/json for object bodies', () => {
    expect(buildResponse({ body: { a: 1 } }).headers['content-type']).toBe('application/json')
  })

  test('infers application/json for array bodies', () => {
    expect(buildResponse({ body: [1, 2] }).headers['content-type']).toBe('application/json')
  })

  test('infers text/plain for string bodies', () => {
    expect(buildResponse({ body: 'hello' }).headers['content-type']).toBe(
      'text/plain; charset=utf-8',
    )
  })

  test('does not override an explicit Content-Type', () => {
    const response = buildResponse({
      headers: { 'Content-Type': 'application/xml' },
      body: { a: 1 },
    })
    expect(response.headers['Content-Type']).toBe('application/xml')
    expect(response.headers['content-type']).toBeUndefined()
  })

  test('infers no Content-Type when there is no body', () => {
    expect(buildResponse({ status: 204 }).headers['content-type']).toBeUndefined()
  })
})
