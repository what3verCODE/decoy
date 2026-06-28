import { TYPE_NUMBER } from '@jmespath-community/jmespath'
import { describe, expect, test } from '@rstest/core'
import {
  type CustomFunction,
  registerCustomFunctions,
  registerStandardFunctions,
  standardFunctions,
} from './functions'
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

describe('registerCustomFunctions', () => {
  test('registers a custom function callable from a ${ } template', () => {
    const double: CustomFunction = {
      name: 'cf_double',
      signature: [{ types: [TYPE_NUMBER] }],
      func: ([n]) => (n as number) * 2,
    }
    registerCustomFunctions([double])

    expect(compileTemplate('${ cf_double(`21`) }')(env())).toBe(42)
  })

  test('composes with the standard library in one expression', () => {
    registerCustomFunctions([
      { name: 'cf_inc', signature: [{ types: [TYPE_NUMBER] }], func: ([n]) => (n as number) + 1 },
    ])
    // length() is a built-in; cf_inc is custom — both resolve in the same expression.
    expect(compileTemplate('${ cf_inc(length(@)) }')(env({ a: 1 }) as object)).toBeTypeOf('number')
  })

  test('is idempotent — re-registering the same name does not throw', () => {
    const fn: CustomFunction = { name: 'cf_idem', signature: [], func: () => 'x' }
    expect(() => {
      registerCustomFunctions([fn])
      registerCustomFunctions([fn])
    }).not.toThrow()
    expect(compileTemplate('${ cf_idem() }')(env())).toBe('x')
  })

  test('never clobbers a standard function registered under the same name', () => {
    // 'uuid' is already standard-registered; a custom impl under that name is skipped,
    // so uuid keeps fabricating real v4 ids (collision *reporting* is the config layer's job).
    registerCustomFunctions([{ name: 'uuid', signature: [], func: () => 'not-a-uuid' }])
    expect(compileTemplate('${ uuid() }')(env())).toMatch(UUID_V4)
  })
})
