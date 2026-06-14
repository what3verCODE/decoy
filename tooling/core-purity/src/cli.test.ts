import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from '@rstest/core'
import { checkPurity, repoRootFrom, run } from './cli'

describe('checkPurity (over a real tree)', () => {
  let root: string

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'core-purity-'))
    const src = join(root, 'packages', 'core', 'src')
    mkdirSync(join(src, 'nested'), { recursive: true })
    writeFileSync(join(src, 'pure.ts'), "import type { X } from './types'\nexport const x = 1\n")
    writeFileSync(join(src, 'nested', 'impure.ts'), "import { readFileSync } from 'node:fs'\n")
    // a test file importing a builtin must be ignored (tests aren't shipped)
    writeFileSync(join(src, 'pure.test.ts'), "import 'node:assert'\n")
    return undefined
  })

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
    return undefined
  })

  test('reports built-in imports in shipped sources, relative to repo root, ignoring tests', () => {
    const result = checkPurity(join(root, 'packages', 'core', 'src'), root)
    expect(result.ok).toBe(false)
    expect(result.scanned).toBe(2)
    expect(result.impurities).toEqual([
      {
        file: join('packages', 'core', 'src', 'nested', 'impure.ts'),
        line: 1,
        specifier: 'node:fs',
      },
    ])
  })
})

describe('run (against the actual @decoy/core)', () => {
  test('resolves the repo root from this module location', () => {
    const root = repoRootFrom(import.meta.url)
    expect(root.endsWith('decoy')).toBe(true)
  })

  test('the shipped @decoy/core passes the purity guard', () => {
    const lines: string[] = []
    const code = run((line) => lines.push(line))
    expect(code).toBe(0)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/@decoy\/core is IO-free — scanned \d+ file\(s\)/)
  })
})
