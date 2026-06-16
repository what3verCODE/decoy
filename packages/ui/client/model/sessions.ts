import { signal } from '@preact/signals'
import { fetchSessionLogs, fetchSessions, type RequestLogRecord, type SessionInfo } from '../api'

export type SessionsLoad =
  | { state: 'loading' }
  | { state: 'ready'; sessions: SessionInfo[] }
  | { state: 'error'; message: string }

/** The live sessions list (global + created) for the sessions inspector. */
export const sessionsLoad = signal<SessionsLoad>({ state: 'loading' })
/** The session the user has drilled into; `null` shows no timeline yet. */
export const selectedSessionId = signal<string | null>(null)

export type TimelineLoad =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'ready'; records: RequestLogRecord[] }
  | { state: 'error'; message: string }

/** The selected session's (cross-service) request timeline. */
export const timeline = signal<TimelineLoad>({ state: 'idle' })

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Load the sessions list — on boot and whenever the sessions view is opened. */
export async function loadSessions(): Promise<void> {
  sessionsLoad.value = { state: 'loading' }
  try {
    sessionsLoad.value = { state: 'ready', sessions: await fetchSessions() }
  } catch (error) {
    sessionsLoad.value = { state: 'error', message: messageOf(error) }
  }
}

/**
 * Drill into a session: load its request timeline (ordered across services, and
 * readable even after the session was destroyed — logs are decoupled from the
 * session lifecycle).
 */
export async function openSession(id: string): Promise<void> {
  selectedSessionId.value = id
  timeline.value = { state: 'loading' }
  try {
    timeline.value = { state: 'ready', records: await fetchSessionLogs(id) }
  } catch (error) {
    timeline.value = { state: 'error', message: messageOf(error) }
  }
}

/** Clear the selected session's timeline (back to just the list). */
export function closeSession(): void {
  selectedSessionId.value = null
  timeline.value = { state: 'idle' }
}
