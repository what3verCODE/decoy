import { describe, expect, test } from '@rstest/core'
import { createLogger, type RequestLog } from './logger'

/** Capture a logger's two output streams instead of writing to the console. */
function sinks(): {
  out: string[]
  err: string[]
  options: { out: (line: string) => void; err: (line: string) => void }
} {
  const out: string[] = []
  const err: string[] = []
  return { out, err, options: { out: (l) => out.push(l), err: (l) => err.push(l) } }
}

const matched: RequestLog = {
  method: 'GET',
  path: '/users/42',
  outcome: {
    type: 'matched',
    address: { route: 'users-by-id', preset: 'default', variant: 'success' },
  },
  status: 200,
  latencyMs: 1.234,
  session: 'global',
}

const miss: RequestLog = {
  method: 'POST',
  path: '/orders',
  outcome: { type: 'miss', reason: 'no-route' },
  status: 501,
  latencyMs: 0.5,
  session: 'global',
}

const passthrough: RequestLog = {
  method: 'GET',
  path: '/profile',
  outcome: { type: 'passthrough', target: 'https://users.real' },
  status: 200,
  latencyMs: 12.5,
  session: 'sess-1',
}

describe('createLogger (pretty, default)', () => {
  test('a matched request logs one line to out with the variant address, status, latency and session', () => {
    const { out, err, options } = sinks()
    createLogger(options).request(matched)

    expect(err).toEqual([])
    expect(out).toHaveLength(1)
    const line = out[0] ?? ''
    expect(line).toContain('GET /users/42')
    expect(line).toContain('users-by-id:default:success')
    expect(line).toContain('200')
    expect(line).toContain('1.2ms')
    expect(line).toContain('global')
  })

  test('a miss logs one line to err (warn level) with MISS(reason)', () => {
    const { out, err, options } = sinks()
    createLogger(options).request(miss)

    expect(out).toEqual([])
    expect(err).toHaveLength(1)
    expect(err[0]).toContain('MISS(no-route)')
    expect(err[0]).toContain('501')
  })

  test('a passthrough logs to out with PASSTHROUGH(target) and the session id', () => {
    const { out, err, options } = sinks()
    createLogger(options).request(passthrough)

    expect(err).toEqual([])
    expect(out[0]).toContain('PASSTHROUGH(https://users.real)')
    expect(out[0]).toContain('sess-1')
  })

  test('lifecycle info/warn pass the message through verbatim', () => {
    const { out, err, options } = sinks()
    const logger = createLogger(options)
    logger.info('listening on http://localhost:4001')
    logger.warn('something odd')

    expect(out).toEqual(['listening on http://localhost:4001'])
    expect(err).toEqual(['something odd'])
  })
})

describe('createLogger (--json)', () => {
  test('a matched request emits one machine-readable line carrying every field', () => {
    const { out, err, options } = sinks()
    createLogger({ ...options, json: true }).request(matched)

    expect(err).toEqual([])
    expect(out).toHaveLength(1)
    expect(JSON.parse(out[0] ?? '')).toEqual({
      method: 'GET',
      path: '/users/42',
      outcome: 'matched',
      route: 'users-by-id',
      preset: 'default',
      variant: 'success',
      status: 200,
      latencyMs: 1.2,
      session: 'global',
    })
  })

  test('a miss emits a warn-level JSON line carrying the reason', () => {
    const { out, err, options } = sinks()
    createLogger({ ...options, json: true }).request(miss)

    expect(out).toEqual([])
    expect(JSON.parse(err[0] ?? '')).toEqual({
      method: 'POST',
      path: '/orders',
      outcome: 'miss',
      reason: 'no-route',
      status: 501,
      latencyMs: 0.5,
      session: 'global',
    })
  })

  test('a passthrough emits the target', () => {
    const { out, options } = sinks()
    createLogger({ ...options, json: true }).request(passthrough)

    expect(JSON.parse(out[0] ?? '')).toMatchObject({
      outcome: 'passthrough',
      target: 'https://users.real',
    })
  })

  test('lifecycle lines are themselves JSON so the whole stream stays parseable', () => {
    const { out, err, options } = sinks()
    const logger = createLogger({ ...options, json: true })
    logger.info('listening')
    logger.warn('odd')

    expect(JSON.parse(out[0] ?? '')).toEqual({ level: 'info', message: 'listening' })
    expect(JSON.parse(err[0] ?? '')).toEqual({ level: 'warn', message: 'odd' })
  })
})
