import { type Controller, createController, type Definitions } from '@decoy/core'
import { describe, expect, test } from '@rstest/core'
import { type CommandContext, processCommand } from './tui-commands'

/** A small two-collection definitions set: happy-path serves success, errors serves error. */
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

const joined = (lines: string[]) => lines.join('\n')

describe('processCommand — slash commands driving the in-process engine', () => {
  test('/collection switches the active collection', () => {
    const { ctx, control } = fixture()
    const outcome = processCommand('/collection errors', ctx)
    expect(control.selection.collection).toBe('errors')
    expect(joined(outcome.lines)).toMatch(/errors/)
    expect(outcome.quit).toBe(false)
  })

  test('/collection with an unknown name reports the error and leaves the selection unchanged', () => {
    const { ctx, control } = fixture()
    const outcome = processCommand('/collection nope', ctx)
    expect(control.selection.collection).toBe('happy-path')
    expect(joined(outcome.lines)).toMatch(/not defined/)
  })

  test('/collection with no argument prints usage', () => {
    const { ctx } = fixture()
    expect(joined(processCommand('/collection', ctx).lines)).toMatch(/usage: \/collection/)
  })

  test('/route pins a route to a variant via a colon address', () => {
    const { ctx, control } = fixture()
    const outcome = processCommand('/route users-by-id:default:error', ctx)
    expect(control.selection.overrides).toEqual([
      { route: 'users-by-id', preset: 'default', variant: 'error' },
    ])
    expect(joined(outcome.lines)).toMatch(/users-by-id:default:error/)
  })

  test('/route also accepts three space-separated arguments', () => {
    const { ctx, control } = fixture()
    processCommand('/route users-by-id default error', ctx)
    expect(control.selection.overrides).toEqual([
      { route: 'users-by-id', preset: 'default', variant: 'error' },
    ])
  })

  test('/route with an unknown address reports the error', () => {
    const { ctx, control } = fixture()
    const outcome = processCommand('/route users-by-id:default:missing', ctx)
    expect(control.selection.overrides ?? []).toEqual([])
    expect(joined(outcome.lines)).toMatch(/not defined/)
  })

  test('/route with a malformed address prints usage', () => {
    const { ctx } = fixture()
    expect(joined(processCommand('/route bad:form', ctx).lines)).toMatch(/usage: \/route/)
  })

  test('/reset clears overrides', () => {
    const { ctx, control } = fixture()
    processCommand('/route users-by-id:default:error', ctx)
    const outcome = processCommand('/reset', ctx)
    expect(control.selection.overrides).toEqual([])
    expect(joined(outcome.lines)).toMatch(/cleared|reset/i)
  })

  test('/collections lists every collection and marks the active one', () => {
    const { ctx } = fixture()
    processCommand('/collection errors', ctx)
    const text = joined(processCommand('/collections', ctx).lines)
    expect(text).toMatch(/happy-path/)
    expect(text).toMatch(/errors/)
    // the active collection is flagged somehow (e.g. a marker on its line)
    const errorsLine = text.split('\n').find((l) => l.includes('errors'))
    expect(errorsLine).toMatch(/\*|active|→/)
  })

  test('/routes lists each route with its method and path', () => {
    const { ctx } = fixture()
    const text = joined(processCommand('/routes', ctx).lines)
    expect(text).toMatch(/users-by-id/)
    expect(text).toMatch(/GET/)
    expect(text).toMatch(/\/users\/\{id\}/)
  })

  test('/status reports the active collection and overrides', () => {
    const { ctx } = fixture()
    processCommand('/collection errors', ctx)
    processCommand('/route users-by-id:default:success', ctx)
    const text = joined(processCommand('/status', ctx).lines)
    expect(text).toMatch(/errors/)
    expect(text).toMatch(/users-by-id:default:success/)
  })

  test('/help lists the available commands', () => {
    const { ctx } = fixture()
    const text = joined(processCommand('/help', ctx).lines)
    for (const cmd of ['/collection', '/route', '/collections', '/routes', '/reset', '/status']) {
      expect(text).toContain(cmd)
    }
  })

  test('/quit asks the loop to stop', () => {
    const { ctx } = fixture()
    expect(processCommand('/quit', ctx).quit).toBe(true)
    expect(processCommand('/exit', ctx).quit).toBe(true)
  })

  test('an unknown slash command is reported', () => {
    const { ctx } = fixture()
    expect(joined(processCommand('/frobnicate', ctx).lines)).toMatch(/unknown command/)
  })

  test('an empty line is ignored (no output, no quit)', () => {
    const { ctx } = fixture()
    expect(processCommand('   ', ctx)).toEqual({ lines: [], quit: false })
  })

  test('plain text without a leading slash hints at slash commands', () => {
    const { ctx } = fixture()
    expect(joined(processCommand('collection errors', ctx).lines)).toMatch(/\/help|start with/)
  })
})
