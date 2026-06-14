import { resolve } from 'node:path'
import type { DecoyServer, Logger } from '@decoy/server'
import { afterEach, describe, expect, test } from '@rstest/core'
import { run } from './cli'

const silent: Logger = { info() {}, warn() {} }
const configPath = resolve(process.cwd(), 'fixtures/basic/decoy.config.ts')

describe('decoy start (end-to-end through the CLI)', () => {
  let server: DecoyServer | undefined

  afterEach(async () => {
    await server?.close()
    server = undefined
  })

  test('boots from a TS config and serves a matched variant', async () => {
    server = await run(['start', '--config', configPath, '--port', '0'], { logger: silent })
    expect(server).toBeDefined()

    const address = server?.raw.address()
    const port = typeof address === 'object' && address ? address.port : 0
    const response = await fetch(`http://localhost:${port}/users/42`)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ id: 42, name: 'Ada' })
  })

  test('rejects an unknown command', async () => {
    await expect(run(['frobnicate'], { logger: silent })).rejects.toThrow(/unknown command/)
  })

  test('help returns without starting a server', async () => {
    const result = await run(['help'], { logger: silent })
    expect(result).toBeUndefined()
  })
})
