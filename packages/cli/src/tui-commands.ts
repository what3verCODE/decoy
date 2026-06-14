import type { Controller, Definitions } from '@decoy/core'

/**
 * Everything a slash command needs to read and drive the running instance: the
 * canonical {@link Controller} (the in-process engine's selection) and the
 * {@link Definitions} it matches against (for listing collections/routes).
 */
export interface CommandContext {
  control: Controller
  definitions: Definitions
}

/** The result of interpreting one input line in the TUI. */
export interface CommandOutcome {
  /** Human-formatted lines to render in the display (already final). */
  lines: string[]
  /** True when the command asked the TUI loop to stop (`/quit`, `/exit`). */
  quit: boolean
}

const HELP_LINES = [
  'Commands:',
  '  /collection <name>            switch the active collection (the whole scenario)',
  '  /route <route>:<preset>:<variant>  pin one route to a variant (override)',
  '  /reset                        drop all per-route overrides',
  '  /collections                  list collections (* = active)',
  '  /routes                       list routes with method + path',
  '  /status                       show the active collection and overrides',
  '  /help                         show this help',
  '  /quit                         exit the TUI (also: /exit)',
]

const ok = (line: string): CommandOutcome => ({ lines: [line], quit: false })
const info = (lines: string[]): CommandOutcome => ({ lines, quit: false })

/** Surface a thrown control error (e.g. `decoy: collection "x" is not defined`) as a line. */
function fail(error: unknown): CommandOutcome {
  return { lines: [error instanceof Error ? error.message : String(error)], quit: false }
}

function listCollections(ctx: CommandContext): CommandOutcome {
  const active = ctx.control.selection.collection
  const lines = [...ctx.definitions.collections.keys()].map(
    (name) => `  ${name === active ? '*' : ' '} ${name}`,
  )
  return info(['Collections:', ...lines])
}

function listRoutes(ctx: CommandContext): CommandOutcome {
  const lines = [...ctx.definitions.routes.values()].map((route) => {
    const presets = Object.keys(route.presets).join(', ')
    const variants = Object.keys(route.variants).join(', ')
    return `  ${route.id} — ${route.method} ${route.path}  [presets: ${presets}] [variants: ${variants}]`
  })
  return info(['Routes:', ...lines])
}

function status(ctx: CommandContext): CommandOutcome {
  const { collection, overrides } = ctx.control.selection
  const lines = [`Collection: ${collection}`]
  if (overrides && overrides.length > 0) {
    lines.push('Overrides:')
    for (const o of overrides) {
      lines.push(`  ${o.route}:${o.preset}:${o.variant}`)
    }
  } else {
    lines.push('Overrides: (none)')
  }
  return info(lines)
}

function setCollection(ctx: CommandContext, name: string | undefined): CommandOutcome {
  if (!name) {
    return ok('usage: /collection <name>')
  }
  try {
    ctx.control.setCollection(name)
    return ok(`Active collection → ${name}`)
  } catch (error) {
    return fail(error)
  }
}

/** Parse `/route` arguments: one `route:preset:variant` token, or three separate tokens. */
function parseAddress(args: string[]): [string, string, string] | undefined {
  const parts = args.length === 1 ? (args[0] ?? '').split(':') : args
  const [route, preset, variant] = parts
  if (parts.length === 3 && route && preset && variant) {
    return [route, preset, variant]
  }
  return undefined
}

function useRoute(ctx: CommandContext, args: string[]): CommandOutcome {
  const address = parseAddress(args)
  if (!address) {
    return ok('usage: /route <route>:<preset>:<variant>')
  }
  const [route, preset, variant] = address
  try {
    ctx.control.useRoute(route, preset, variant)
    return ok(`Override → ${route}:${preset}:${variant}`)
  } catch (error) {
    return fail(error)
  }
}

/**
 * Interpret one input line against the running instance. Slash commands drive the
 * controller (and thus the in-process engine) directly; an empty line is a no-op,
 * and plain text is hinted back toward the slash syntax. Pure: all IO (reading
 * input, rendering output) lives in the TUI runtime around this.
 */
export function processCommand(input: string, ctx: CommandContext): CommandOutcome {
  const trimmed = input.trim()
  if (trimmed === '') {
    return { lines: [], quit: false }
  }
  if (!trimmed.startsWith('/')) {
    return ok("commands start with '/' — type /help for the list")
  }

  const [token = '', ...args] = trimmed.slice(1).split(/\s+/)
  const command = token.toLowerCase()

  switch (command) {
    case 'collection':
      return setCollection(ctx, args[0])
    case 'route':
      return useRoute(ctx, args)
    case 'reset':
      ctx.control.reset()
      return ok('Overrides cleared.')
    case 'collections':
      return listCollections(ctx)
    case 'routes':
      return listRoutes(ctx)
    case 'status':
      return status(ctx)
    case 'help':
      return info(HELP_LINES)
    case 'quit':
    case 'exit':
      return { lines: ['Bye.'], quit: true }
    default:
      return ok(`unknown command: /${token} — type /help for the list`)
  }
}
