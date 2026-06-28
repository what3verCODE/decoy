import { describe, expect, test } from '@rstest/core'
import { planMatched, planMiss, planResponse } from './serialize'
import type { MatchResult, MockResponse } from './types'

function response(partial: Partial<MockResponse>): MockResponse {
  return { status: 200, headers: {}, body: undefined, ...partial }
}

describe('planMatched', () => {
  test('JSON-stringifies an object body and infers content-type', () => {
    const plan = planMatched(response({ status: 200, body: { id: 42, name: 'Ada' } }))

    expect(plan.status).toBe(200)
    expect(plan.headers['content-type']).toBe('application/json')
    expect(plan.body).toBe('{"id":42,"name":"Ada"}')
  })

  test('passes a string body through without inferring content-type', () => {
    const plan = planMatched(response({ headers: { 'content-type': 'text/plain' }, body: 'hi' }))

    expect(plan.body).toBe('hi')
    expect(plan.headers['content-type']).toBe('text/plain')
  })

  test('keeps an explicit content-type over the inferred one', () => {
    const plan = planMatched(
      response({ headers: { 'content-type': 'application/problem+json' }, body: { e: 1 } }),
    )

    expect(plan.headers['content-type']).toBe('application/problem+json')
    expect(plan.body).toBe('{"e":1}')
  })

  test('sends no payload for a null or undefined body', () => {
    expect(planMatched(response({ body: undefined })).body).toBeUndefined()
    expect(planMatched(response({ body: null })).body).toBeUndefined()
  })

  test('does not mutate the input headers', () => {
    const input = response({ body: { a: 1 } })
    planMatched(input)

    expect(input.headers).toEqual({})
  })
})

describe('planMiss', () => {
  test('fails closed with x-mock-miss and a JSON diagnostic body', () => {
    const plan = planMiss('no route matched', 501)

    expect(plan.status).toBe(501)
    expect(plan.headers).toEqual({ 'x-mock-miss': 'true', 'content-type': 'application/json' })
    expect(plan.body).toBe('{"error":"no route matched"}')
  })
})

describe('planResponse', () => {
  test('serializes a matched result', () => {
    const result: MatchResult = {
      type: 'matched',
      address: { route: 'r', preset: 'default', variant: 'ada' },
      pathParams: {},
      response: response({ status: 201, body: { ok: true } }),
    }

    expect(planResponse(result, 501)).toEqual(planMatched(result.response))
  })

  test('fails closed for a miss with the given status', () => {
    const result: MatchResult = {
      type: 'miss',
      reason: { kind: 'no-route', method: 'GET', path: '/x' },
      message: 'no route',
    }

    expect(planResponse(result, 418)).toEqual(planMiss('no route', 418))
  })
})
