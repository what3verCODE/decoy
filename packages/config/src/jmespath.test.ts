import { describe, expect, test } from '@rstest/core'
import { validateJmespath } from './jmespath'

const noop = () => null

describe('validateJmespath', () => {
  test('accepts a valid set of custom functions', () => {
    const issues = validateJmespath(
      { functions: [{ name: 'greet', signature: [], func: noop }] },
      'decoy.config.ts',
      'service "api"',
    )
    expect(issues).toEqual([])
  })

  test('reports a collision with a standard function clearly', () => {
    const issues = validateJmespath(
      { functions: [{ name: 'uuid', signature: [], func: noop }] },
      'decoy.config.ts',
      'service "api"',
    )
    expect(issues).toHaveLength(1)
    expect(issues[0]?.severity).toBe('error')
    expect(issues[0]?.message).toContain('jmespath function "uuid" collides with the standard')
    expect(issues[0]?.file).toBe('decoy.config.ts')
  })

  test('reports a duplicate name within the set', () => {
    const issues = validateJmespath(
      {
        functions: [
          { name: 'dup', signature: [], func: noop },
          { name: 'dup', signature: [], func: noop },
        ],
      },
      'decoy.config.ts',
      'service "api"',
    )
    expect(issues).toHaveLength(1)
    expect(issues[0]?.message).toContain('duplicate jmespath function "dup"')
  })

  test('skips a malformed entry (the schema reports its shape)', () => {
    const issues = validateJmespath(
      { functions: [{ signature: [], func: noop }] },
      'decoy.config.ts',
      'service "api"',
    )
    expect(issues).toEqual([])
  })

  test('returns nothing for an absent or non-object jmespath block', () => {
    expect(validateJmespath(undefined, 'f', 's')).toEqual([])
    expect(validateJmespath({}, 'f', 's')).toEqual([])
    expect(validateJmespath('nope', 'f', 's')).toEqual([])
  })
})
