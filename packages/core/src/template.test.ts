import { describe, expect, test } from '@rstest/core'
import { compileTemplate, hasTemplates, scanTemplateExpressions } from './template'

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

describe('compileTemplate — whole-string yields the raw typed value', () => {
  test('a number expression preserves the number type', () => {
    const render = compileTemplate('${ length(body.items) }')
    expect(render(env({ body: { items: [1, 2, 3] } }))).toBe(3)
  })

  test('a boolean comparison preserves the boolean type', () => {
    const render = compileTemplate("${ body.role == 'admin' }")
    expect(render(env({ body: { role: 'admin' } }))).toBe(true)
  })

  test('an object expression preserves the object', () => {
    const render = compileTemplate('${ body.user }')
    expect(render(env({ body: { user: { id: 1 } } }))).toEqual({ id: 1 })
  })

  test('a path param renders as its raw (string) value', () => {
    expect(compileTemplate('${ pathParams.id }')(env())).toBe('42')
  })

  test('a missing path renders as null (lenient)', () => {
    expect(compileTemplate('${ body.nope }')(env({ body: {} }))).toBeNull()
  })

  test('surrounding whitespace inside the braces is ignored', () => {
    expect(compileTemplate('${pathParams.id}')(env())).toBe('42')
  })
})

describe('compileTemplate — embedded expressions interpolate as a string', () => {
  test('interpolates a value between literal text', () => {
    expect(compileTemplate('Hi ${ body.name }!')(env({ body: { name: 'Ada' } }))).toBe('Hi Ada!')
  })

  test('a number embedded in text stringifies', () => {
    expect(compileTemplate('count=${ length(body.items) }')(env({ body: { items: [1, 2] } }))).toBe(
      'count=2',
    )
  })

  test('a missing path embedded in text renders as empty string', () => {
    expect(compileTemplate('a-${ body.nope }-b')(env({ body: {} }))).toBe('a--b')
  })

  test('an object embedded in text JSON-stringifies', () => {
    expect(compileTemplate('u=${ body.user }')(env({ body: { user: { id: 1 } } }))).toBe(
      'u={"id":1}',
    )
  })

  test('two back-to-back expressions interpolate (not whole-string)', () => {
    expect(compileTemplate('${ pathParams.id }${ pathParams.id }')(env())).toBe('4242')
  })
})

describe('compileTemplate — literals, escapes, and the no-template fast path', () => {
  test('a string with no ${ } renders as itself', () => {
    expect(compileTemplate('plain text')(env())).toBe('plain text')
  })

  test('\\${ escapes to a literal ${ (backslash consumed)', () => {
    expect(compileTemplate('price is \\${ 5 }')(env())).toBe('price is ${ 5 }')
  })

  test('an escaped delimiter alongside a real one renders both', () => {
    expect(compileTemplate('\\${ literal } and ${ pathParams.id }')(env())).toBe(
      '${ literal } and 42',
    )
  })

  test('an empty string stays empty', () => {
    expect(compileTemplate('')(env())).toBe('')
  })
})

describe('compileTemplate — deep rendering; keys are never templated', () => {
  test('renders nested object and array leaves, preserving non-string leaves', () => {
    const render = compileTemplate({
      id: '${ pathParams.id }',
      count: '${ length(body.items) }',
      greeting: 'Hi ${ body.name }!',
      label: 'static',
      nested: { ids: ['${ pathParams.id }', 2] },
      flag: true,
    })
    expect(render(env({ body: { items: [1, 2], name: 'Ada' } }))).toEqual({
      id: '42',
      count: 2,
      greeting: 'Hi Ada!',
      label: 'static',
      nested: { ids: ['42', 2] },
      flag: true,
    })
  })

  test('keys that look like templates are left untouched', () => {
    const render = compileTemplate({ '${ pathParams.id }': 'value' })
    expect(render(env())).toEqual({ '${ pathParams.id }': 'value' })
  })
})

describe('scanTemplateExpressions — extracts every ${ } expression source', () => {
  test('returns the trimmed inner JMESPath of each occurrence', () => {
    expect(scanTemplateExpressions('a ${ body.x } b ${ pathParams.id }')).toEqual([
      'body.x',
      'pathParams.id',
    ])
  })

  test('brace-balanced scan supports }-containing expressions', () => {
    expect(scanTemplateExpressions('${ {id: pathParams.id, n: length(body.items)} }')).toEqual([
      '{id: pathParams.id, n: length(body.items)}',
    ])
  })

  test('an escaped delimiter is not an expression', () => {
    expect(scanTemplateExpressions('\\${ not an expr }')).toEqual([])
  })

  test('no ${ } yields no expressions', () => {
    expect(scanTemplateExpressions('plain')).toEqual([])
  })
})

describe('compileTemplate — brace-balanced multiselect-hash', () => {
  test('a }-containing expression renders as a typed value', () => {
    const render = compileTemplate('${ {id: pathParams.id, n: length(body.items)} }')
    expect(render(env({ body: { items: [1, 2] } }))).toEqual({ id: '42', n: 2 })
  })
})

describe('hasTemplates', () => {
  test('true when any string leaf contains ${', () => {
    expect(hasTemplates({ a: 'x', b: ['${ y }'] })).toBe(true)
  })

  test('true for an escaped delimiter (it needs de-escaping)', () => {
    expect(hasTemplates('\\${ x }')).toBe(true)
  })

  test('false when no string leaf contains ${', () => {
    expect(hasTemplates({ a: 'x', b: [1, true, null] })).toBe(false)
  })
})
