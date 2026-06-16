import { computed, signal } from '@preact/signals'
import { connectLogs, type LogStream, type RequestLogRecord } from '../api'

/** Most recent records first; bounded so a long session can't grow unboundedly. */
const MAX_LOG_ROWS = 500
export const logs = signal<RequestLogRecord[]>([])
export const paused = signal(false)
export const logCount = computed(() => logs.value.length)
// Highest seq ingested — dedupes history the server replays after an SSE reconnect.
let maxSeq = 0
// Records that arrived while paused, held back until resume (newest-first).
let pausedBuffer: RequestLogRecord[] = []

function prepend(records: RequestLogRecord[]): void {
  logs.value = [...records, ...logs.value].slice(0, MAX_LOG_ROWS)
}

function ingest(record: RequestLogRecord): void {
  if (record.seq <= maxSeq) {
    return // already seen (replayed on reconnect)
  }
  maxSeq = record.seq
  if (paused.value) {
    pausedBuffer = [record, ...pausedBuffer]
    return
  }
  prepend([record])
}

/** Open the live request stream into the `logs` signal — called once on boot. */
export function startLogStream(): LogStream {
  return connectLogs(ingest)
}

export function clearLogs(): void {
  logs.value = []
  pausedBuffer = []
}

export function togglePause(): void {
  paused.value = !paused.value
  if (!paused.value && pausedBuffer.length > 0) {
    prepend(pausedBuffer)
    pausedBuffer = []
  }
}
