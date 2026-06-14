import { resolve } from 'node:path'
import type { DecoyServer, Logger } from '@decoy/server'
import { afterEach, describe, expect, test } from '@rstest/core'
import { run } from './cli'

const silent: Logger = { info() {}, warn() {} }
const configPath = resolve(process.cwd(), 'fixtures/basic/decoy.config.ts')
const invalidConfigPath = resolve(process.cwd(), 'fixtures/invalid/decoy.config.ts')

/** Capture CLI output so a test can assert on the printed report. */
function capture(): { out: (message: string) => void; text: () => string } {
  const lines: string[] = []
  return { out: (message) => lines.push(message), text: () => lines.join('\n') }
}

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

describe('decoy check (CI validation gate)', () => {
  test('a valid config validates clean and exits zero (resolves)', async () => {
    const { out, text } = capture()
    const result = await run(['check', '--config', configPath], { out })

    expect(result).toBeUndefined()
    expect(text()).toMatch(/valid/)
  })

  test('an invalid config rejects (non-zero exit) and reports every issue with file:line', async () => {
    const { out, text } = capture()

    await expect(run(['check', '--config', invalidConfigPath], { out })).rejects.toThrow(
      /validation failed/,
    )

    const report = text()
    expect(report).toMatch(/undefined variant "missing"/)
    expect(report).toMatch(/collections\.yaml:\d+/)
  })
})
