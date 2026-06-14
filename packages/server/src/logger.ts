/** Minimal leveled logger. The `--json` variant and richer fields land in #38. */
export interface Logger {
  info(message: string): void
  warn(message: string): void
}

export const consoleLogger: Logger = {
  info(message) {
    console.log(message)
  },
  warn(message) {
    console.warn(message)
  },
}
