import { createInterface } from 'node:readline'
import { createLogger, type Logger } from '@decoy/server'
import { type CommandContext, processCommand } from './tui-commands'

export type { CommandContext, CommandOutcome } from './tui-commands'
export { processCommand } from './tui-commands'

/**
 * The IO seam the TUI runtime drives. The default ({@link readlineIo}) reads lines
 * from stdin and writes to stdout; tests inject a scripted `lines` iterable and a
 * capturing `write` so the loop runs deterministically with no real terminal.
 */
export interface TuiIo {
  /** Input lines, one per Enter. Iteration completing ends the loop. */
  lines: AsyncIterable<string>
  /** Render one line to the display. */
  write: (line: string) => void
  /** Optional: draw the input prompt (called before each read). */
  prompt?: () => void
  /** Optional: release the input resource when the loop ends. */
  close?: () => void
}

/** The interactive TUI: a {@link Logger} for live request logs + a `run` loop. */
export interface Tui {
  /**
   * A logger that renders live request/lifecycle lines into the TUI display.
   * Pass it to `createServer` so every request shows up in the TUI.
   */
  logger: Logger
  /** Drive the input loop against the controller; resolves when the user quits or input ends. */
  run: (ctx: CommandContext) => Promise<void>
}

const GREETING = 'decoy TUI — drive the in-process engine. Type /help for commands, /quit to exit.'

/** The default stdin/stdout IO backed by `node:readline`. */
function readlineIo(): TuiIo {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  rl.setPrompt('decoy> ')
  // Ctrl-C closes the interface, which ends the async iteration and the loop.
  rl.on('SIGINT', () => rl.close())
  return {
    lines: rl,
    write: (line) => process.stdout.write(`${line}\n`),
    prompt: () => rl.prompt(),
    close: () => rl.close(),
  }
}

/**
 * Create the interactive TUI over an {@link TuiIo} (defaults to stdin/stdout). The
 * returned `logger` should be wired into `createServer` so live request lines
 * render alongside command output; `run` consumes input lines, interprets each as
 * a slash command, and writes the result until the user quits or input ends.
 */
export function createTui(io: TuiIo = readlineIo()): Tui {
  return {
    logger: createLogger({ out: io.write, err: io.write }),
    async run(ctx) {
      io.write(GREETING)
      io.prompt?.()
      for await (const raw of io.lines) {
        const outcome = processCommand(raw, ctx)
        for (const line of outcome.lines) {
          io.write(line)
        }
        if (outcome.quit) {
          break
        }
        io.prompt?.()
      }
      io.close?.()
    },
  }
}
