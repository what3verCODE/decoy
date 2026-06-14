import { watch as fsWatch } from 'node:fs'
import type { LoadedService } from '@decoy/config'

/** A handle to stop watching and release every underlying fs watcher. */
export interface Watcher {
  /** Stop watching; pending reload results are discarded. */
  close(): void
}

/**
 * Injectable filesystem watcher (mirrors the relevant slice of `node:fs` `watch`):
 * given a path and a change callback, returns a closable handle. Structural typing
 * keeps the orchestration unit-testable with a plain fake.
 */
export type WatchFn = (path: string, onChange: () => void) => { close(): void }

/**
 * Injectable debounce scheduler: run `fn` after `ms`, returning a cancel function.
 * Defaults to an `unref`'d `setTimeout`; a test passes a manual one.
 */
export type Scheduler = (fn: () => void, ms: number) => () => void

export interface WatchSourcesOptions {
  /** Filesystem paths (files or dirs) to watch for changes. */
  paths: string[]
  /** Re-load the service from disk; rejects (e.g. `ValidationError`) on an invalid config. */
  reload: () => Promise<LoadedService>
  /** Called with the freshly loaded service after a successful re-load. */
  onReload: (service: LoadedService) => void
  /** Called when a re-load fails — the caller keeps the current definitions. */
  onError: (error: unknown) => void
  /** Debounce window (ms) coalescing rapid file events into one reload. Default 100. */
  debounceMs?: number
  /** Injectable fs watcher (defaults to a recursive `node:fs` watcher). */
  watch?: WatchFn
  /** Injectable debounce scheduler (defaults to an `unref`'d `setTimeout`). */
  scheduler?: Scheduler
}

const defaultWatch: WatchFn = (path, onChange) =>
  fsWatch(path, { recursive: true }, () => onChange())

const defaultScheduler: Scheduler = (fn, ms) => {
  const timer = setTimeout(fn, ms)
  timer.unref?.()
  return () => clearTimeout(timer)
}

/**
 * Watch a set of source paths and re-load on change (hot reload, #44). File events
 * are debounced; a reload runs `reload()` and reports the result via `onReload`
 * (success) or `onError` (failure — the caller keeps the old definitions). Reloads
 * never overlap: a change arriving mid-reload schedules a single follow-up. After
 * `close()`, in-flight results are dropped.
 */
export function watchSources(options: WatchSourcesOptions): Watcher {
  const debounceMs = options.debounceMs ?? 100
  const watchFn = options.watch ?? defaultWatch
  const scheduler = options.scheduler ?? defaultScheduler

  let cancel: (() => void) | undefined
  let running = false
  let pending = false
  let closed = false

  async function run(): Promise<void> {
    if (running) {
      // A reload is in flight; remember the change and run once it finishes.
      pending = true
      return
    }
    running = true
    try {
      const service = await options.reload()
      if (!closed) {
        options.onReload(service)
      }
    } catch (error) {
      if (!closed) {
        options.onError(error)
      }
    } finally {
      running = false
      if (pending && !closed) {
        pending = false
        schedule()
      }
    }
  }

  function schedule(): void {
    cancel?.()
    cancel = scheduler(() => {
      cancel = undefined
      void run()
    }, debounceMs)
  }

  const handles = options.paths.map((path) => {
    try {
      return watchFn(path, schedule)
    } catch {
      // A path that vanished between resolution and watch setup — skip it,
      // still watch the rest.
      return undefined
    }
  })

  return {
    close() {
      closed = true
      cancel?.()
      cancel = undefined
      for (const handle of handles) {
        handle?.close()
      }
    },
  }
}
