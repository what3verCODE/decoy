import { randomUUID } from 'node:crypto'
import { type Controller, createController, type Definitions } from '@decoy/core'

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
  /** Destroy a session; `true` if it existed. The global session has no id and is unaffected. */
  destroy(sessionId: string): boolean
  /** Whether a (non-global) session with this id is live. */
  has(sessionId: string): boolean
  /** Reap every session idle past the TTL; returns the reaped ids (`[]` with no TTL). */
  reapIdle(): string[]
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

  const newSession = (): Session => ({
    controller: createController(definitions, defaultCollection),
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
    destroy(sessionId) {
      return sessions.delete(sessionId)
    },
    has(sessionId) {
      return sessions.has(sessionId)
    },
    reapIdle,
    stop() {
      if (timer) {
        clearInterval(timer)
        timer = undefined
      }
    },
  }
}
