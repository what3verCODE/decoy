import { resolve } from 'node:path'
import { describe, expect, test } from '@rstest/core'
import { bindLineAt, loadSourceDoc } from './source'
import {
  formatIssues,
  hasErrors,
  type RawCollection,
  type RawRoute,
  type ValidationIssue,
  validateSources,
} from './validate'

const fixtures = `${resolve(process.cwd(), 'fixtures')}/`

function route(data: unknown, file = 'route.yaml'): RawRoute {
  return { data, file, lineAt: () => undefined }
}

function collection(data: unknown, file = 'collections.yaml'): RawCollection {
  return { data, file, lineAt: () => undefined }
}

function messages(issues: ValidationIssue[]): string[] {
  return issues.map((i) => i.message)
}

describe('validateSources — schema', () => {
  test('reports schema errors for bad method, path, and missing id', () => {
    const issues = validateSources({
      routes: [route({ method: 'FETCH', path: 'no-slash', presets: {}, variants: {} })],
      collections: [],
    })

    expect(hasErrors(issues)).toBe(true)
    expect(messages(issues)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('id'),
        expect.stringContaining('method'),
        expect.stringContaining('path'),
      ]),
    )
  })

  test('accepts a well-formed route + collection with no issues', () => {
    const issues = validateSources({
      routes: [
        route({
          id: 'users-api',
          method: 'get',
          path: '/users',
          presets: { default: {} },
          variants: { success: { status: 200, body: { ok: true } } },
        }),
      ],
      collections: [collection({ id: 'happy', routes: ['users-api:default:success'] })],
    })

    expect(issues).toEqual([])
  })
})

describe('validateSources — duplicate ids & overlap', () => {
  test('duplicate route id is an error naming the first definition', () => {
    const base = { method: 'GET', path: '/a', presets: { default: {} }, variants: { ok: {} } }
    const issues = validateSources({
      routes: [
        route({ id: 'dup', ...base }, 'first.yaml'),
        route({ id: 'dup', ...base, path: '/b' }, 'second.yaml'),
      ],
      collections: [],
    })

    const dup = issues.find((i) => i.message.includes('duplicate route id'))
    expect(dup?.severity).toBe('error')
    expect(dup?.file).toBe('second.yaml')
    expect(dup?.message).toContain('first.yaml')
  })

  test('overlapping method+path is a warning, not an error', () => {
    const issues = validateSources({
      routes: [
        route({ id: 'me', method: 'GET', path: '/users/me', presets: {}, variants: {} }),
        route({ id: 'byId', method: 'GET', path: '/users/{id}', presets: {}, variants: {} }),
      ],
      collections: [],
    })

    const overlap = issues.find((i) => i.message.includes('overlaps'))
    expect(overlap?.severity).toBe('warning')
    expect(hasErrors(issues)).toBe(false)
  })

  test('different methods or non-overlapping paths do not warn', () => {
    const issues = validateSources({
      routes: [
        route({ id: 'a', method: 'GET', path: '/users', presets: {}, variants: {} }),
        route({ id: 'b', method: 'POST', path: '/users', presets: {}, variants: {} }),
        route({ id: 'c', method: 'GET', path: '/orders', presets: {}, variants: {} }),
      ],
      collections: [],
    })

    expect(issues.filter((i) => i.message.includes('overlaps'))).toEqual([])
  })
})

describe('validateSources — cross-reference', () => {
  const routes = [
    route({
      id: 'users-api',
      method: 'GET',
      path: '/users',
      presets: { default: {} },
      variants: { success: {} },
    }),
  ]

  test('undefined route, preset, and variant each error', () => {
    const issues = validateSources({
      routes,
      collections: [
        collection({
          id: 'happy',
          routes: ['ghost:default:success', 'users-api:ghost:success', 'users-api:default:ghost'],
        }),
      ],
    })

    expect(messages(issues)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('undefined route "ghost"'),
        expect.stringContaining('undefined preset "ghost"'),
        expect.stringContaining('undefined variant "ghost"'),
      ]),
    )
  })

  test('malformed entry (not route:preset:variant) errors', () => {
    const issues = validateSources({
      routes,
      collections: [collection({ id: 'happy', routes: ['users-api:default'] })],
    })

    expect(issues.some((i) => i.message.includes('malformed entry'))).toBe(true)
  })

  test('a fully resolvable address produces no cross-reference error', () => {
    const issues = validateSources({
      routes,
      collections: [collection({ id: 'happy', routes: ['users-api:default:success'] })],
    })

    expect(issues).toEqual([])
  })
})

describe('validateSources — extends', () => {
  test('extends an undefined collection is an error', () => {
    const issues = validateSources({
      routes: [],
      collections: [collection({ id: 'child', extends: 'nope', routes: [] })],
    })

    expect(issues.some((i) => i.message.includes('extends undefined collection "nope"'))).toBe(true)
  })

  test('a cyclic extends chain is an error', () => {
    const issues = validateSources({
      routes: [],
      collections: [
        collection({ id: 'a', extends: 'b', routes: [] }),
        collection({ id: 'b', extends: 'a', routes: [] }),
      ],
    })

    expect(issues.some((i) => i.message.includes('cyclic'))).toBe(true)
  })
})

describe('validateSources — JMESPath', () => {
  test('invalid match: predicate and invalid {{ template }} both error', () => {
    const issues = validateSources({
      routes: [
        route({
          id: 'users-api',
          method: 'GET',
          path: '/users',
          presets: { active: { match: 'foo[' } },
          variants: { success: { body: { label: '{{ bad[ }}' } } },
        }),
      ],
      collections: [],
    })

    expect(messages(issues)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('invalid JMESPath in preset "active" match'),
        expect.stringContaining('invalid JMESPath template'),
      ]),
    )
  })

  test('valid match: and {{ template }} produce no issue', () => {
    const issues = validateSources({
      routes: [
        route({
          id: 'users-api',
          method: 'GET',
          path: '/users',
          presets: { active: { match: 'length(body.items) > `0`' } },
          variants: { success: { body: { count: '{{ length(body.items) }}' } } },
        }),
      ],
      collections: [],
    })

    expect(issues).toEqual([])
  })
})

describe('validateSources — file:line', () => {
  test('attaches real line numbers from the YAML source', async () => {
    const doc = await loadSourceDoc(`${fixtures}validation/users.yaml`)
    const issues = validateSources({
      routes: [{ data: doc.data, file: doc.file, lineAt: bindLineAt(doc) }],
      collections: [],
    })

    const path = issues.find((i) => i.message.startsWith('path:'))
    expect(path?.line).toBe(3)

    const match = issues.find((i) => i.message.includes('match'))
    expect(match?.line).toBe(7)

    const template = issues.find((i) => i.message.includes('template'))
    expect(template?.line).toBe(12)

    // Every issue carries the file.
    for (const issue of issues) {
      expect(issue.file).toBe(doc.file)
    }
  })
})

describe('formatIssues', () => {
  test('renders severity, file:line, and message', () => {
    const text = formatIssues([
      { severity: 'error', message: 'boom', file: 'a.yaml', line: 4 },
      { severity: 'warning', message: 'meh', file: 'b.yaml' },
    ])

    expect(text).toBe('error: a.yaml:4 — boom\nwarning: b.yaml — meh')
  })
})
