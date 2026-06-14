import type { LoadedService } from '@decoy/config'
import { describe, expect, test } from '@rstest/core'
import { type Scheduler, type WatchFn, watchSources } from './watch'

/** A stand-in service — `watchSources` only forwards it to `onReload`, never inspects it. */
const service = { name: 'decoy' } as LoadedService

/** Let queued microtasks/timers settle so an async reload resolves. */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

/** A fake fs watcher: records listeners and which paths were closed. */
function fakeWatch(failOn?: string) {
  const listeners: Array<() => void> = []
  const closed: string[] = []
  const watch: WatchFn = (path, onChange) => {
    if (path === failOn) {
      throw new Error(`ENOENT: ${path}`)
    }
    listeners.push(onChange)
    return {
      close() {
        closed.push(path)
      },
    }
  }
  return {
    watch,
    emit: () => {
      for (const l of listeners) {
        l()
      }
    },
    listeners,
    closed,
  }
}

/** A manual debounce scheduler: holds the latest scheduled fn until `flush()`. */
function manualScheduler() {
  let queued: (() => void) | undefined
  const scheduler: Scheduler = (fn) => {
    queued = fn
    return () => {
      if (queued === fn) {
        queued = undefined
      }
    }
  }
  return {
    scheduler,
    pending: () => queued !== undefined,
    flush: () => {
      const fn = queued
      queued = undefined
      fn?.()
    },
  }
}

describe('watchSources', () => {
  test('a watched-source change triggers a reload and reports the new service', async () => {
    const fw = fakeWatch()
    const ms = manualScheduler()
    let reloaded: LoadedService | undefined

    watchSources({
      paths: ['routes', 'collections.yaml'],
      reload: async () => service,
      onReload: (s) => {
        reloaded = s
      },
      onError: () => {
        throw new Error('unexpected error')
      },
      watch: fw.watch,
      scheduler: ms.scheduler,
    })

    fw.emit()
    expect(ms.pending()).toBe(true)
    ms.flush()
    await tick()

    expect(reloaded).toBe(service)
  })

  test('a failing reload reports the error and never calls onReload (old definitions kept)', async () => {
    const fw = fakeWatch()
    const ms = manualScheduler()
    let errored: unknown
    let reloads = 0

    watchSources({
      paths: ['routes'],
      reload: async () => {
        reloads += 1
        throw new Error('invalid config')
      },
      onReload: () => {
        throw new Error('onReload must not run on a failed reload')
      },
      onError: (e) => {
        errored = e
      },
      watch: fw.watch,
      scheduler: ms.scheduler,
    })

    fw.emit()
    ms.flush()
    await tick()

    expect(reloads).toBe(1)
    expect((errored as Error).message).toBe('invalid config')
  })

  test('rapid changes coalesce into a single reload', async () => {
    const fw = fakeWatch()
    const ms = manualScheduler()
    let reloads = 0

    watchSources({
      paths: ['routes'],
      reload: async () => {
        reloads += 1
        return service
      },
      onReload: () => {},
      onError: () => {},
      watch: fw.watch,
      scheduler: ms.scheduler,
    })

    fw.emit()
    fw.emit()
    fw.emit()
    ms.flush()
    await tick()

    expect(reloads).toBe(1)
  })

  test('close stops watching and reports no further reloads', async () => {
    const fw = fakeWatch()
    const ms = manualScheduler()
    let reloaded: LoadedService | undefined

    const watcher = watchSources({
      paths: ['routes', 'collections.yaml'],
      reload: async () => service,
      onReload: (s) => {
        reloaded = s
      },
      onError: () => {},
      watch: fw.watch,
      scheduler: ms.scheduler,
    })

    fw.emit()
    watcher.close()
    ms.flush()
    await tick()

    expect(reloaded).toBeUndefined()
    expect(fw.closed).toEqual(['routes', 'collections.yaml'])
  })

  test('a reload still in flight when close is called does not report its result', async () => {
    const fw = fakeWatch()
    const ms = manualScheduler()
    let reloaded: LoadedService | undefined
    let release: (() => void) | undefined

    const watcher = watchSources({
      paths: ['routes'],
      reload: () => new Promise<LoadedService>((resolve) => (release = () => resolve(service))),
      onReload: (s) => {
        reloaded = s
      },
      onError: () => {},
      watch: fw.watch,
      scheduler: ms.scheduler,
    })

    fw.emit()
    ms.flush() // run() starts, awaiting the in-flight reload
    watcher.close()
    release?.()
    await tick()

    expect(reloaded).toBeUndefined()
  })

  test('a change arriving during an in-flight reload is not lost', async () => {
    const fw = fakeWatch()
    const ms = manualScheduler()
    let reloads = 0
    let releaseFirst: (() => void) | undefined

    watchSources({
      paths: ['routes'],
      reload: () => {
        reloads += 1
        if (reloads === 1) {
          return new Promise<LoadedService>((resolve) => (releaseFirst = () => resolve(service)))
        }
        return Promise.resolve(service)
      },
      onReload: () => {},
      onError: () => {},
      watch: fw.watch,
      scheduler: ms.scheduler,
    })

    fw.emit()
    ms.flush() // first reload starts and blocks
    fw.emit()
    ms.flush() // re-entered while running → remembered, not run yet
    releaseFirst?.()
    await tick() // first finishes → a follow-up reload is re-scheduled
    ms.flush()
    await tick()

    expect(reloads).toBe(2)
  })

  test('a watch setup failure on one path does not prevent watching the others', async () => {
    const fw = fakeWatch('bad')
    const ms = manualScheduler()
    let reloaded: LoadedService | undefined

    watchSources({
      paths: ['bad', 'good'],
      reload: async () => service,
      onReload: (s) => {
        reloaded = s
      },
      onError: () => {},
      watch: fw.watch,
      scheduler: ms.scheduler,
    })

    expect(fw.listeners).toHaveLength(1) // only 'good' is watched
    fw.emit()
    ms.flush()
    await tick()

    expect(reloaded).toBe(service)
  })
})
