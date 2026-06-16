import { describe, expect, test } from '@rstest/core'
import { registerStandardFunctions, standardFunctions } from './functions'
import { compileTemplate } from './template'

const env = (overrides: Record<string, unknown> = {}) => ({
  method: 'GET',
  path: '/users/42',
  pathParams: { id: '42' },
  query: {},
  headers: {},
  cookies: {},
  body: undefined,
  ...overrides,
})

/** RFC 4122 version-4 UUID: lowercase, hyphenated, with the `4` and variant nibbles pinned. */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('the finalized standard-function set', () => {
  test('declares uuid as the inaugural function', () => {
    expect(standardFunctions.map((fn) => fn.name)).toContain('uuid')
  })

  test('uuid takes no arguments (empty signature)', () => {
    const uuid = standardFunctions.find((fn) => fn.name === 'uuid')
    expect(uuid?.signature).toEqual([])
  })
})

describe('uuid() is callable from a ${ } template', () => {
  // template.ts registers the standard library on load, so uuid resolves without
  // the caller registering anything — this mirrors how the engine evaluates.
  test('a whole-string expression yields an RFC 4122 v4 string', () => {
    const value = compileTemplate('${ uuid() }')(env())
    expect(value).toMatch(UUID_V4)
  })

  test('it fabricates a fresh value per render (non-deterministic by design)', () => {
    const render = compileTemplate('${ uuid() }')
    expect(render(env())).not.toBe(render(env()))
  })

  test('it interpolates inside surrounding text', () => {
    const value = compileTemplate('urn:uuid:${ uuid() }')(env()) as string
    expect(value.startsWith('urn:uuid:')).toBe(true)
    expect(value.slice('urn:uuid:'.length)).toMatch(UUID_V4)
  })
})

describe('registerStandardFunctions is idempotent', () => {
  test('repeated registration neither throws nor breaks uuid', () => {
    expect(() => {
      registerStandardFunctions()
      registerStandardFunctions()
    }).not.toThrow()
    expect(compileTemplate('${ uuid() }')(env())).toMatch(UUID_V4)
  })
})
