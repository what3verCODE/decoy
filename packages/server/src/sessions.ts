import { randomUUID } from 'node:crypto'
import { type Controller, createController, type Definitions, type ReloadResult } from '@decoy/core'

/**
 * The label of the **global** (default) session — what no/empty-`x-mock-session`
 * requests resolve against and what their request-log records are tagged with. A
 * shared constant so the registry listing, the request-log `session` column, and a
 * `GET /admin/sessions/global/logs` query all agree on one literal.
 */
export const GLOBAL_SESSION = 'global'

/** One session's {@link ReloadResult}, tagged with the session label (`'global'` or its id). */
export interface SessionReloadResult extends ReloadResult {
  /** The reloaded session: `'global'` for the default session, otherwise its id. */
  session: string
}

/** One live session in {@link SessionRegistry.list}: its id plus a selection summary. */
export interface SessionInfo {
  /** `'global'` ({@link GLOBAL_SESSION}) for the default session, otherwise the created id. */
  id: string
  /** True for the default (global) dev session — the no-header target. */
  global: boolean
  /** The session's active collection name. */
  collection: string
  /** Number of per-route overrides currently pinned in the session. */
  overrideCount: number
}

/**
 * Tuning for the session registry. All optional: a registry with no `idleTtlMs`
 * never reaps (suited to dev, where the single global session lives forever). The
 * `now`/`generateId` hooks exist for deterministic tests.
 */
export interface SessionRegistryOptions {
  /** Reap a session untouched for longer than this (ms). Omitted → no reaping. */
  idleTtlMs?: number
  /** Background reaper sweep interval (ms). Defaults to `min(idleTtlMs, 60_000)`; `0` disables it. */
  reapIntervalMs?: number
  /** Clock injection (defaults to `Date.now`). */
  now?: () => number
  /** Session-id generator injection (defaults to `crypto.randomUUID`). */
  generateId?: () => string
  /** Called after a background sweep that reaped ≥1 session, with the reaped ids. */
  onReap?: (ids: string[]) => void
  /**
   * Called when a session is explicitly destroyed (`destroy`), with its id — so an
   * observer (e.g. the request-log store's `cleanup: 'on-session-end'`) can react
   * to the session ending. Not called for reaped sessions (see {@link onReap}).
   */
  onDestroy?: (sessionId: string) => void
}

/**
 * The set of live **sessions** on one server (ADR-0011). Each session owns its own
 * {@link Controller} (selection), so parallel e2e tests sharing a server never stomp
 * each other. The **global** session is the default — what dev's no-header requests
 * and `/admin` mutate. Created sessions are keyed by the `x-mock-session` header; an
 * unknown id is lazily auto-created on `resolve`. Abandoned sessions are cleaned up
 * by an idle-TTL reaper.
 */
export interface SessionRegistry {
  /** The default session's controller — mutated by no-header (dev) requests. */
  readonly global: Controller
  /** Number of live (non-global) sessions. */
  readonly size: number
  /**
   * The controller for `sessionId` — the global session for `undefined`/`''`,
   * otherwise the matching session (lazily created if unknown). Touches the
   * session's last-seen so an active session is never reaped.
   */
  resolve(sessionId: string | undefined): Controller
  /** Explicitly create a new session, returning its generated id. */
  create(): string
  /**
   * List the live sessions — the **global** (default) session first, then every
   * created session in creation order. Each entry carries the session's active
   * collection and override count so a UI (#71) can show the selection at a glance.
   * Reading the list never touches a session's last-seen, so it can't keep an idle
   * session alive.
   */
  list(): SessionInfo[]
  /** Destroy a session; `true` if it existed. The global session has no id and is unaffected. */
  destroy(sessionId: string): boolean
  /** Whether a (non-global) session with this id is live. */
  has(sessionId: string): boolean
  /** Reap every session idle past the TTL; returns the reaped ids (`[]` with no TTL). */
  reapIdle(): string[]
  /**
   * Hot reload (#44): swap the definitions for the global session and every live
   * session, preserving each selection by name (a vanished collection falls back
   * to `defaultCollection`; stale overrides are dropped). Sessions created *after*
   * this call use the reloaded definitions. Returns one {@link SessionReloadResult}
   * per session so the caller can warn on fallbacks/dropped overrides.
   */
  reload(definitions: Definitions, defaultCollection: string): SessionReloadResult[]
  /** Stop the background reaper. */
  stop(): void
}

interface Session {
  controller: Controller
  lastSeen: number
}

/**
 * Create a {@link SessionRegistry} over the given definitions. Every session (and
 * the global one) starts on `defaultCollection`. When `idleTtlMs` is set a
 * background interval reaps idle sessions; the timer is `unref`'d so it never keeps
 * the process alive, and `stop()` clears it.
 */
export function createSessionRegistry(
  definitions: Definitions,
  defaultCollection: string,
  options: SessionRegistryOptions = {},
): SessionRegistry {
  const now = options.now ?? Date.now
  const generateId = options.generateId ?? randomUUID
  const { idleTtlMs } = options
  const global = createController(definitions, defaultCollection)
  const sessions = new Map<string, Session>()
  // Latest definitions/default — swapped by reload() so sessions born after a
  // reload start on the current definitions, not the boot-time ones.
  let currentDefinitions = definitions
  let currentDefault = defaultCollection

  const newSession = (): Session => ({
    controller: createController(currentDefinitions, currentDefault),
    lastSeen: now(),
  })

  function reapIdle(): string[] {
    if (idleTtlMs === undefined) {
      return []
    }
    const cutoff = now() - idleTtlMs
    const reaped: string[] = []
    for (const [id, session] of sessions) {
      if (session.lastSeen <= cutoff) {
        sessions.delete(id)
        reaped.push(id)
      }
    }
    return reaped
  }

  let timer: ReturnType<typeof setInterval> | undefined
  if (idleTtlMs !== undefined && options.reapIntervalMs !== 0) {
    const interval = options.reapIntervalMs ?? Math.min(idleTtlMs, 60_000)
    timer = setInterval(() => {
      const reaped = reapIdle()
      if (reaped.length > 0) {
        options.onReap?.(reaped)
      }
    }, interval)
    // Never let the reaper keep the process alive (dev/CLI run to Ctrl-C).
    timer.unref?.()
  }

  return {
    global,
    get size() {
      return sessions.size
    },
    resolve(sessionId) {
      if (sessionId === undefined || sessionId === '') {
        return global
      }
      const existing = sessions.get(sessionId)
      if (existing) {
        existing.lastSeen = now()
        return existing.controller
      }
      const session = newSession()
      sessions.set(sessionId, session)
      return session.controller
    },
    create() {
      let id = generateId()
      while (sessions.has(id)) {
        id = generateId()
      }
      sessions.set(id, newSession())
      return id
    },
    list() {
      const summarize = (id: string, isGlobal: boolean, controller: Controller): SessionInfo => ({
        id,
        global: isGlobal,
        collection: controller.selection.collection,
        overrideCount: controller.selection.overrides?.length ?? 0,
      })
      const infos = [summarize(GLOBAL_SESSION, true, global)]
      for (const [id, session] of sessions) {
        infos.push(summarize(id, false, session.controller))
      }
      return infos
    },
    destroy(sessionId) {
      const existed = sessions.delete(sessionId)
      if (existed) {
        options.onDestroy?.(sessionId)
      }
      return existed
    },
    has(sessionId) {
      return sessions.has(sessionId)
    },
    reapIdle,
    reload(definitions, defaultCollection) {
      currentDefinitions = definitions
      currentDefault = defaultCollection
      const results: SessionReloadResult[] = [
        { session: 'global', ...global.reload(definitions, defaultCollection) },
      ]
      for (const [id, session] of sessions) {
        results.push({ session: id, ...session.controller.reload(definitions, defaultCollection) })
      }
      return results
    },
    stop() {
      if (timer) {
        clearInterval(timer)
        timer = undefined
      }
    },
  }
}
