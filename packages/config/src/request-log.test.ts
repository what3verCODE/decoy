import { describe, expect, test } from '@rstest/core'
import { resolveLogPath, unknownTemplateTokens, validateRequestLog } from './request-log'
import { validateSources } from './validate'

// A fixed instant: 2026-06-15T09:08:07.000Z → strftime fields are deterministic in UTC.
const NOW = new Date(Date.UTC(2026, 5, 15, 9, 8, 7))
const ctx = { name: 'users', pid: 4242, port: 4000, now: NOW }

describe('resolveLogPath', () => {
  test('expands strftime time tokens (UTC) and named tokens', () => {
    expect(resolveLogPath('.decoy/{name}-{pid}-{port}.sqlite', ctx)).toBe(
      '.decoy/users-4242-4000.sqlite',
    )
    expect(resolveLogPath('logs/%Y/%m/%d/%H%M%S.db', ctx)).toBe('logs/2026/06/15/090807.db')
  })

  test('%s renders the Unix epoch in seconds', () => {
    expect(resolveLogPath('req-%s.sqlite', ctx)).toBe(
      `req-${Math.floor(NOW.getTime() / 1000)}.sqlite`,
    )
  })

  test('leaves non-token text untouched and resolves repeated tokens', () => {
    expect(resolveLogPath('{name}/{name}.sqlite', ctx)).toBe('users/users.sqlite')
  })

  test('throws on an unknown token (resolver safety net after validation)', () => {
    expect(() => resolveLogPath('{bogus}.sqlite', ctx)).toThrow(/unknown token/)
    expect(() => resolveLogPath('%Q.sqlite', ctx)).toThrow(/unknown time token/)
  })
})

describe('unknownTemplateTokens', () => {
  test('returns [] when every token is supported', () => {
    expect(unknownTemplateTokens('.decoy/{name}-%Y%m%d-{pid}-{port}.sqlite')).toEqual([])
  })

  test('reports each unsupported token verbatim', () => {
    expect(unknownTemplateTokens('{bogus}-%Q-{host}.sqlite')).toEqual(['{bogus}', '%Q', '{host}'])
  })
})

describe('validateRequestLog', () => {
  test('an unknown path token is an error', () => {
    const issues = validateRequestLog(
      { store: 'sqlite', path: '.decoy/{bogus}.sqlite' },
      'decoy.config.ts',
      'service "users"',
    )
    expect(issues).toEqual([
      {
        severity: 'error',
        message: 'error in service "users": requestLog.path has unknown token(s): {bogus}',
        file: 'decoy.config.ts',
      },
    ])
  })

  test('a known path token is clean', () => {
    expect(validateRequestLog({ store: 'sqlite', path: '.decoy/{name}.sqlite' }, 'f', 's')).toEqual(
      [],
    )
  })

  test('cleanup on the memory store is a no-op warning', () => {
    const issues = validateRequestLog(
      { store: 'memory', cleanup: 'on-exit' },
      'f',
      'service "users"',
    )
    expect(issues).toHaveLength(1)
    expect(issues[0]?.severity).toBe('warning')
    expect(issues[0]?.message).toMatch(/no-op for the in-memory store/)
  })

  test('cleanup defaults to the memory store when store is omitted', () => {
    const issues = validateRequestLog({ cleanup: 'never' }, 'f', 's')
    expect(issues[0]?.severity).toBe('warning')
  })

  test('on-session-end on sqlite warns that post-session retrieval is disabled', () => {
    const issues = validateRequestLog(
      { store: 'sqlite', cleanup: 'on-session-end' },
      'f',
      'service "users"',
    )
    expect(issues).toHaveLength(1)
    expect(issues[0]?.severity).toBe('warning')
    expect(issues[0]?.message).toMatch(/post-session log retrieval is disabled/)
  })

  test('a sqlite cleanup of on-exit/never is clean', () => {
    expect(validateRequestLog({ store: 'sqlite', cleanup: 'on-exit' }, 'f', 's')).toEqual([])
    expect(validateRequestLog({ store: 'sqlite', cleanup: 'never' }, 'f', 's')).toEqual([])
  })

  test('a non-object requestLog yields no extra issues (schema owns the type error)', () => {
    expect(validateRequestLog('nope', 'f', 's')).toEqual([])
    expect(validateRequestLog(undefined, 'f', 's')).toEqual([])
  })
})

describe('validateSources surfaces requestLog token errors (the decoy check seam)', () => {
  test('an unknown filename token blocks validation', () => {
    const issues = validateSources({
      config: {
        data: { requestLog: { store: 'sqlite', path: '.decoy/{nope}.sqlite' } },
        file: 'decoy.config.ts',
        service: 'service "users"',
      },
      routes: [],
      collections: [],
    })
    expect(
      issues.some(
        (i) => i.severity === 'error' && /requestLog\.path has unknown token/.test(i.message),
      ),
    ).toBe(true)
  })
})
