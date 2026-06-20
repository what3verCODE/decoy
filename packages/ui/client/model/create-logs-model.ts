import { createEffect, createEvent, createStore, sample } from 'effector'
import { not, reset } from 'patronum'
import { connectLogs, type LogStream, type RequestLogRecord } from '../api'

const MAX_LOG_ROWS = 500

export function createLogsModel() {
  const $logs = createStore<RequestLogRecord[]>([])
  const $paused = createStore(false)

  const $maxSeq = createStore<number>(0)
  const $pausedBuffer = createStore<RequestLogRecord[]>([])

  const $stream = createStore<LogStream | null>(null)

  const startLogStream = createEvent()
  const prepend = createEvent<RequestLogRecord[]>()
  const ingest = createEvent<RequestLogRecord>()
  const togglePause = createEvent()
  const clear = createEvent()

  const startLogStreamFx = createEffect(() => connectLogs(ingest))

  sample({
    clock: startLogStream,
    target: startLogStreamFx,
  })

  sample({
    clock: startLogStreamFx.doneData,
    target: $stream,
  })

  sample({
    clock: prepend,
    source: $logs,
    fn: (logs, records) => [...records, ...logs].slice(0, MAX_LOG_ROWS),
    target: $logs,
  })

  const shouldApplyLogs = sample({
    clock: ingest,
    source: $maxSeq,
    filter: (maxSeq, record) => record.seq > maxSeq,
    fn: (_, record) => record,
  })

  sample({
    clock: shouldApplyLogs,
    fn: (record) => record.seq,
    target: $maxSeq,
  })

  sample({
    clock: shouldApplyLogs,
    source: { paused: $paused, buffer: $pausedBuffer },
    filter: ({ paused }) => paused === true,
    fn: ({ buffer }, record) => [record, ...buffer],
    target: $pausedBuffer,
  })

  sample({
    clock: shouldApplyLogs,
    filter: not($paused),
    fn: (record) => [record],
    target: prepend,
  })

  sample({
    clock: togglePause,
    source: $paused,
    fn: (paused) => !paused,
    target: $paused,
  })

  const shouldPrependChanged = sample({
    clock: $paused,
    source: $pausedBuffer,
    filter: (buffer, paused) => !paused && buffer.length > 0,
  })

  sample({
    clock: shouldPrependChanged,
    source: $pausedBuffer,
    target: prepend,
  })

  sample({
    clock: shouldPrependChanged,
    fn: () => [],
    target: $pausedBuffer,
  })

  reset({ clock: clear, target: [$logs, $pausedBuffer] })

  return {
    $logs,
    $paused,

    startLogStream,
    togglePause,
    clear,
  }
}
