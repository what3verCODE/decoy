import { useUnit } from 'effector-react'
import type { JSX } from 'preact'
import { resolutionOf } from '../api'
import { logsModel } from '../model'
import { MethodBadge, StatusBadge } from './badges'

export function LiveStream(): JSX.Element {
  const [logs, paused, handleTogglePause, handleClear] = useUnit([
    logsModel.$logs,
    logsModel.$paused,
    logsModel.togglePause,
    logsModel.clear,
  ])

  return (
    <section class="h-full flex flex-col overflow-hidden" data-testid="live-stream">
      <div class="tile-drag-handle flex items-center gap-2 h-9 px-4 border-b border-border shrink-0">
        <h2 class="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Live Requests
        </h2>
        <span class="text-[11px] text-muted-foreground tabular-nums">{logs.length}</span>
        <div class="flex-1" />
        <button
          type="button"
          onClick={handleTogglePause}
          data-testid="logs-pause"
          class="text-[11px] px-1.5 h-[18px] rounded border border-border text-muted-foreground hover:bg-muted/60 transition-colors"
        >
          {paused ? 'resume' : 'pause'}
        </button>
        <button
          type="button"
          onClick={handleClear}
          data-testid="logs-clear"
          class="text-[11px] px-1.5 h-[18px] rounded border border-border text-muted-foreground hover:bg-muted/60 transition-colors"
        >
          clear
        </button>
      </div>
      <div class="overflow-y-auto flex-1">
        <Logs />
      </div>
    </section>
  )
}

function Logs() {
  const logs = useUnit(logsModel.$logs)

  if (logs.length === 0) {
    return <p class="px-4 py-6 text-muted-foreground text-[12px]">waiting for requests…</p>
  }

  return (
    <table class="w-full border-collapse">
      <thead class="sticky top-0 bg-card z-10">
        <tr class="text-[10px] uppercase tracking-wider text-muted-foreground text-left">
          <th class="font-medium px-4 py-1.5 w-16">method</th>
          <th class="font-medium px-2 py-1.5">path</th>
          <th class="font-medium px-2 py-1.5">resolution</th>
          <th class="font-medium px-2 py-1.5 w-14 text-right">status</th>
          <th class="font-medium px-2 py-1.5 w-16 text-right">latency</th>
          <th class="font-medium px-2 py-1.5 w-20">service</th>
          <th class="font-medium px-4 py-1.5 w-24">session</th>
        </tr>
      </thead>
      <tbody>
        {logs.map((record) => {
          const miss = record.outcome.type === 'miss'
          return (
            <tr
              key={record.seq}
              data-testid="log-row"
              class={`border-b border-border/60 transition-colors ${
                miss ? 'bg-rose/10 hover:bg-rose/20' : 'hover:bg-muted/60'
              }`}
            >
              <td class="px-4 py-1.5">
                <MethodBadge method={record.method} />
              </td>
              <td class="px-2 py-1.5 font-mono text-[12px] text-foreground">{record.path}</td>
              <td
                class={`px-2 py-1.5 font-mono text-[12px] ${
                  miss ? 'text-rose' : 'text-muted-foreground'
                }`}
              >
                {resolutionOf(record.outcome)}
              </td>
              <td class="px-2 py-1.5 text-right">
                <StatusBadge status={record.status} />
              </td>
              <td class="px-2 py-1.5 font-mono text-[12px] text-foreground text-right tabular-nums">
                {record.latencyMs.toFixed(1)}ms
              </td>
              <td
                class="px-2 py-1.5 font-mono text-[12px] text-muted-foreground truncate"
                data-testid="log-service"
              >
                {record.service ?? ''}
              </td>
              <td class="px-4 py-1.5 font-mono text-[12px] text-muted-foreground truncate">
                {record.session}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
