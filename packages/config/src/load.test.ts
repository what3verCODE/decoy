import { resolve } from 'node:path'
import { describe, expect, test } from '@rstest/core'
import { loadConfig, resolveWatchPaths, validateConfig } from './load'
import { ValidationError } from './validate'

const fixtures = `${resolve(process.cwd(), 'fixtures')}/`

describe('loadConfig', () => {
  test('loads a YAML config with routesDir + collectionsFile', async () => {
    const service = await loadConfig({ configPath: `${fixtures}yaml-config/decoy.config.yaml` })

    expect(service.name).toBe('users')
    expect(service.port).toBe(4101)
    expect(service.defaultCollection).toBe('happy-path')
    expect([...service.definitions.routes.keys()]).toEqual(['users-list-api'])
    expect(service.definitions.routes.get('users-list-api')?.path).toBe('/users/{id}')
    expect([...service.definitions.collections.keys()]).toEqual(['happy-path'])
  })

  test('resolves a configured missStatus', async () => {
    const service = await loadConfig({ configPath: `${fixtures}yaml-config/decoy.config.yaml` })
    expect(service.missStatus).toBe(503)
  })

  test('missStatus defaults to 501 when unset', async () => {
    const service = await loadConfig({ cwd: `${fixtures}defaults` })
    expect(service.missStatus).toBe(501)
  })

  test('resolves a configured passthrough target with a trimmed trailing slash', async () => {
    const service = await loadConfig({ configPath: `${fixtures}yaml-config/decoy.config.yaml` })
    expect(service.passthrough).toEqual({ url: 'https://users.real' })
  })

  test('passthrough is off (undefined) when unset', async () => {
    const service = await loadConfig({ cwd: `${fixtures}defaults` })
    expect(service.passthrough).toBeUndefined()
  })

  test('rejects an invalid passthrough.url with file:line', async () => {
    const error = await loadConfig({
      configPath: `${fixtures}bad-passthrough/decoy.config.yaml`,
    }).then(
      () => undefined,
      (e) => e,
    )

    expect(error).toBeInstanceOf(ValidationError)
    const issues = (error as ValidationError).issues
    const urlIssue = issues.find((i) => i.message.includes('passthrough.url'))
    expect(urlIssue?.severity).toBe('error')
    expect(urlIssue?.file).toContain('decoy.config.yaml')
    expect(urlIssue?.line).toBe(4)
  })

  test('resolves a configured sessionIdleTtl', async () => {
    const service = await loadConfig({ configPath: `${fixtures}yaml-config/decoy.config.yaml` })
    expect(service.sessionIdleTtlMs).toBe(60000)
  })

  test('sessionIdleTtl defaults to 30 minutes when unset', async () => {
    const service = await loadConfig({ cwd: `${fixtures}defaults` })
    expect(service.sessionIdleTtlMs).toBe(30 * 60 * 1000)
  })

  test('rejects a non-positive sessionIdleTtl with file:line', async () => {
    const error = await loadConfig({
      configPath: `${fixtures}bad-session-ttl/decoy.config.yaml`,
    }).then(
      () => undefined,
      (e) => e,
    )

    expect(error).toBeInstanceOf(ValidationError)
    const issues = (error as ValidationError).issues
    const ttlIssue = issues.find((i) => i.message.includes('sessionIdleTtl'))
    expect(ttlIssue?.severity).toBe('error')
    expect(ttlIssue?.file).toContain('decoy.config.yaml')
    expect(ttlIssue?.line).toBe(3)
  })

  test('resolves the admin config to a separate port and normalized prefix', async () => {
    const service = await loadConfig({ configPath: `${fixtures}yaml-config/decoy.config.yaml` })

    expect(service.admin).toEqual({ enabled: true, prefix: '/control', port: 5101 })
  })

  test('falls back to the default-path source when no config file exists', async () => {
    const service = await loadConfig({ cwd: `${fixtures}defaults` })

    expect(service.defaultCollection).toBe('happy-path')
    expect(service.definitions.routes.get('users-list-api')?.path).toBe('/users')
    // admin defaults to on, same port, `/admin` prefix
    expect(service.admin).toEqual({ enabled: true, prefix: '/admin' })
  })

  test('panics when neither config nor default-path source is present', async () => {
    await expect(loadConfig({ cwd: `${fixtures}empty` })).rejects.toThrow(/no decoy config/)
  })

  test('rejects an explicit config path that does not exist', async () => {
    await expect(loadConfig({ configPath: `${fixtures}nope/decoy.config.yaml` })).rejects.toThrow(
      /not found/,
    )
  })

  test('throws a ValidationError carrying file:line on a validation error', async () => {
    const error = await loadConfig({ cwd: `${fixtures}broken` }).then(
      () => undefined,
      (e) => e,
    )

    expect(error).toBeInstanceOf(ValidationError)
    const issues = (error as ValidationError).issues
    expect(issues.some((i) => i.message.includes('undefined variant "ghost"'))).toBe(true)
    expect(issues.every((i) => i.severity === 'error')).toBe(true)
    expect(issues[0]?.file).toContain('collections.yaml')
    expect(issues[0]?.line).toBeGreaterThan(0)
  })

  test('rejects an out-of-range missStatus with file:line', async () => {
    const error = await loadConfig({
      configPath: `${fixtures}bad-miss-status/decoy.config.yaml`,
    }).then(
      () => undefined,
      (e) => e,
    )

    expect(error).toBeInstanceOf(ValidationError)
    const issues = (error as ValidationError).issues
    const missIssue = issues.find((i) => i.message.includes('missStatus'))
    expect(missIssue?.severity).toBe('error')
    expect(missIssue?.file).toContain('decoy.config.yaml')
    expect(missIssue?.line).toBe(3)
  })

  test('warnings (overlapping routes) do not block boot', async () => {
    const service = await loadConfig({ cwd: `${fixtures}overlap` })
    expect([...service.definitions.routes.keys()]).toEqual(
      expect.arrayContaining(['users-me-api', 'users-by-id-api']),
    )
  })
})

describe('validateConfig', () => {
  test('returns the overlap warning without throwing', async () => {
    const issues = await validateConfig({ cwd: `${fixtures}overlap` })
    expect(issues.some((i) => i.severity === 'warning' && i.message.includes('overlaps'))).toBe(
      true,
    )
    expect(issues.every((i) => i.severity === 'warning')).toBe(true)
  })

  test('returns no issues for a valid project', async () => {
    const issues = await validateConfig({ cwd: `${fixtures}defaults` })
    expect(issues).toEqual([])
  })
})

describe('resolveWatchPaths', () => {
  test('watches the config file, routesDir and collectionsFile', async () => {
    const base = `${fixtures}yaml-config`
    const paths = await resolveWatchPaths({ configPath: `${base}/decoy.config.yaml` })

    expect(paths).toEqual([
      resolve(base, 'decoy.config.yaml'),
      resolve(base, 'mocks/routes'),
      resolve(base, 'mocks/collections.yaml'),
    ])
  })

  test('watches the default-path source when booting without a config file', async () => {
    const base = `${fixtures}defaults`
    const paths = await resolveWatchPaths({ cwd: base })

    // No config file present — only the default routesDir + collectionsFile.
    expect(paths).toEqual([resolve(base, 'mocks/routes'), resolve(base, 'mocks/collections.yaml')])
  })

  test('panics when no source can be resolved', async () => {
    await expect(resolveWatchPaths({ cwd: `${fixtures}does-not-exist` })).rejects.toThrow(
      /no decoy config found/,
    )
  })
})
