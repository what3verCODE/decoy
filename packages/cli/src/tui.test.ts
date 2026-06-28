import { type Controller, createController, type Definitions } from '@decoy/core'
import { describe, expect, test } from '@rstest/core'
import { type CommandContext, createTui, type TuiIo } from './tui'

function fixture(): { ctx: CommandContext; control: Controller } {
  const definitions: Definitions = {
    routes: new Map([
      [
        'users-by-id',
        {
          id: 'users-by-id',
          method: 'GET',
          path: '/users/{id}',
          presets: { default: {} },
          variants: {
            success: { status: 200, body: { id: 42 } },
            error: { status: 500, body: { error: 'boom' } },
          },
        },
      ],
    ]),
    collections: new Map([
      ['happy-path', { id: 'happy-path', routes: ['users-by-id:default:success'] }],
      ['errors', { id: 'errors', routes: ['users-by-id:default:error'] }],
    ]),
  }
  const control = createController(definitions, 'happy-path')
  return { ctx: { control, definitions }, control }
}

/** Feed scripted input lines and capture everything written to the display. */
function scriptedIo(input: string[]): { io: TuiIo; written: string[]; closed: () => boolean } {
  const written: string[] = []
  let didClose = false
  async function* lines(): AsyncIterable<string> {
    for (const line of input) {
      yield line
    }
  }
  return {
    io: {
      lines: lines(),
      write: (line) => written.push(line),
      close: () => {
        didClose = true
      },
    },
    written,
    closed: () => didClose,
  }
}

describe('createTui — the interactive runtime', () => {
  test('runs scripted commands, drives the in-process engine, and stops on /quit', async () => {
    const { ctx, control } = fixture()
    const { io, written } = scriptedIo(['/collection errors', '/quit', '/collection happy-path'])
    const tui = createTui(io)

    await tui.run(ctx)

    // The collection switched in-process...
    expect(control.selection.collection).toBe('errors')
    // ...and /quit stopped the loop, so the line after it was never processed.
    expect(written.join('\n')).toMatch(/errors/)
    expect(written.join('\n')).not.toMatch(/happy-path/)
  })

  test('switching collections actually changes what the engine serves', async () => {
    const { ctx, control } = fixture()
    const { io } = scriptedIo(['/collection errors'])
    await createTui(io).run(ctx)

    const request = {
      method: 'GET',
      url: '/users/1',
      path: '/users/1',
      params: { id: '1' },
      query: {},
      headers: {},
      cookies: {},
      body: undefined,
    }
    const result = control.match(request)
    expect(result.type).toBe('matched')
    if (result.type === 'matched') {
      expect(result.response.status).toBe(500)
    }
  })

  test('the logger renders live per-request lines into the display', async () => {
    const { written, io } = scriptedIo([])
    const tui = createTui(io)

    tui.logger.request({
      method: 'GET',
      path: '/users/42',
      outcome: {
        type: 'matched',
        address: { route: 'users-by-id', preset: 'default', variant: 'success' },
      },
      status: 200,
      latencyMs: 1.2,
      session: 'global',
    })

    expect(written.join('\n')).toMatch(/GET \/users\/42 → users-by-id:default:success 200/)
  })

  test('the loop ends and cleans up when input is exhausted (no explicit /quit)', async () => {
    const { ctx } = fixture()
    const { io, closed } = scriptedIo(['/status'])
    await createTui(io).run(ctx)
    expect(closed()).toBe(true)
  })

  test('a greeting is shown when the loop starts', async () => {
    const { ctx } = fixture()
    const { io, written } = scriptedIo([])
    await createTui(io).run(ctx)
    expect(written.join('\n')).toMatch(/\/help/)
  })
})
