import { resolve } from 'node:path'
import { describe, expect, test } from '@rstest/core'
import { loadConfig } from './load'

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
})
