import { describe, expect, test } from '@rstest/core'
import { extractModuleSpecifiers, findImpurities, isNodeBuiltin, scanSource } from './purity'

describe('isNodeBuiltin', () => {
  test('flags node:-prefixed specifiers', () => {
    expect(isNodeBuiltin('node:fs')).toBe(true)
    expect(isNodeBuiltin('node:http')).toBe(true)
    expect(isNodeBuiltin('node:path')).toBe(true)
  })

  test('flags bare builtin names and their subpaths', () => {
    expect(isNodeBuiltin('fs')).toBe(true)
    expect(isNodeBuiltin('path')).toBe(true)
    expect(isNodeBuiltin('fs/promises')).toBe(true)
    expect(isNodeBuiltin('stream/web')).toBe(true)
  })

  test('does not flag relative or third-party specifiers', () => {
    expect(isNodeBuiltin('./path')).toBe(false)
    expect(isNodeBuiltin('../engine')).toBe(false)
    expect(isNodeBuiltin('@decoy/core')).toBe(false)
    expect(isNodeBuiltin('typescript')).toBe(false)
    expect(isNodeBuiltin('valibot')).toBe(false)
  })
})

describe('extractModuleSpecifiers', () => {
  test('finds every import/export/require/dynamic-import form with line numbers', () => {
    const content = [
      "import { readFileSync } from 'node:fs'",
      "import './side-effect'",
      "export { x } from '../neighbor'",
      "const p = require('node:path')",
      "const u = await import('node:url')",
      "import type { Buffer } from 'node:buffer'",
    ].join('\n')

    expect(extractModuleSpecifiers(content)).toEqual([
      { specifier: 'node:fs', line: 1 },
      { specifier: './side-effect', line: 2 },
      { specifier: '../neighbor', line: 3 },
      { specifier: 'node:path', line: 4 },
      { specifier: 'node:url', line: 5 },
      { specifier: 'node:buffer', line: 6 },
    ])
  })
})

describe('scanSource', () => {
  test('reports only Node built-in imports as impurities', () => {
    const content = [
      "import { createEngine } from './engine'",
      "import { readFileSync } from 'node:fs'",
      "import http from 'http'",
    ].join('\n')

    expect(scanSource('packages/core/src/x.ts', content)).toEqual([
      { file: 'packages/core/src/x.ts', line: 2, specifier: 'node:fs' },
      { file: 'packages/core/src/x.ts', line: 3, specifier: 'http' },
    ])
  })

  test('a pure source yields no impurities', () => {
    const content = [
      "import type { Selection } from './types'",
      'export const ok = (s: Selection) => s',
    ].join('\n')
    expect(scanSource('packages/core/src/pure.ts', content)).toEqual([])
  })
})

describe('findImpurities', () => {
  test('aggregates across files', () => {
    const result = findImpurities([
      { file: 'a.ts', content: "import 'node:os'" },
      { file: 'b.ts', content: "import './local'" },
      { file: 'c.ts', content: "import 'crypto'" },
    ])
    expect(result).toEqual([
      { file: 'a.ts', line: 1, specifier: 'node:os' },
      { file: 'c.ts', line: 1, specifier: 'crypto' },
    ])
  })
})
