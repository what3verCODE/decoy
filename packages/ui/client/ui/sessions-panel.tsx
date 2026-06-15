import type { JSX } from 'preact'
import { resolutionOf } from '../api'
import {
  closeSession,
  openSession,
  selectedSessionId,
  sessionsLoad,
  timeline,
} from '../model/sessions'
import { MethodBadge, StatusBadge } from './badges'

/** The selected session's request timeline — ordered, cross-service, survives destroy. */
function Timeline(): JSX.Element | null {
  const id = selectedSessionId.value
  if (id === null) {
    return null
  }
  const current = timeline.value
  return (
    <div data-testid="session-timeline" class="border-t border-border">
      <div class="flex items-center gap-2 h-7 px-4">
        <h3 class="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Timeline
        </h3>
        <span class="font-mono text-[11px] text-foreground truncate">{id}</span>
        <div class="flex-1" />
        <button
          type="button"
          data-testid="session-timeline-close"
          onClick={closeSession}
          class="text-[11px] px-1.5 h-[18px] rounded border border-border text-muted-foreground hover:bg-muted/60 transition-colors"
        >
          close
        </button>
      </div>
      {current.state === 'loading' && (
        <p class="px-4 py-4 text-muted-foreground text-[12px]">loading timeline…</p>
      )}
      {current.state === 'error' && (
        <p class="px-4 py-4 text-rose text-[12px]" data-testid="session-timeline-error">
          {current.message}
        </p>
      )}
      {current.state === 'ready' && current.records.length === 0 && (
        <p class="px-4 py-4 text-muted-foreground text-[12px]">no requests in this session</p>
      )}
      {current.state === 'ready' && current.records.length > 0 && (
        <table class="w-full border-collapse">
          <thead class="sticky top-0 bg-card z-10">
            <tr class="text-[10px] uppercase tracking-wider text-muted-foreground text-left">
              <th class="font-medium px-4 py-1.5 w-16">method</th>
              <th class="font-medium px-2 py-1.5">path</th>
              <th class="font-medium px-2 py-1.5">resolution</th>
              <th class="font-medium px-2 py-1.5 w-20">service</th>
              <th class="font-medium px-4 py-1.5 w-14 text-right">status</th>
            </tr>
          </thead>
          <tbody>
            {current.records.map((record) => {
              const miss = record.outcome.type === 'miss'
              return (
                <tr
                  key={record.seq}
                  data-testid="timeline-row"
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
                  <td class="px-2 py-1.5 font-mono text-[11px] text-muted-foreground truncate">
                    {record.service ?? ''}
                  </td>
                  <td class="px-4 py-1.5 text-right">
                    <StatusBadge status={record.status} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

export function SessionsPanel(): JSX.Element {
  const current = sessionsLoad.value
  const selected = selectedSessionId.value
  return (
    <section class="flex-1 min-w-0 flex flex-col overflow-hidden" data-testid="sessions-panel">
      <div class="flex items-center h-9 px-4 border-b border-border shrink-0">
        <h2 class="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Sessions
        </h2>
      </div>
      <div class="overflow-y-auto flex-1">
        {current.state === 'loading' && (
          <p class="px-4 py-6 text-muted-foreground text-[12px]">loading sessions…</p>
        )}
        {current.state === 'error' && (
          <p class="px-4 py-6 text-rose text-[12px]" data-testid="sessions-error">
            {current.message}
          </p>
        )}
        {current.state === 'ready' && (
          <>
            <ul>
              {current.sessions.map((session) => {
                const isSelected = session.id === selected
                return (
                  <li key={session.id}>
                    <button
                      type="button"
                      data-testid="session-row"
                      data-session-id={session.id}
                      data-selected={isSelected ? 'true' : 'false'}
                      onClick={() => void openSession(session.id)}
                      class={`w-full flex items-center gap-2 px-4 py-1.5 text-left border-l-2 transition-colors ${
                        isSelected
                          ? 'border-emerald bg-muted/60 text-foreground'
                          : 'border-transparent text-muted-foreground hover:bg-muted/40'
                      }`}
                    >
                      <span class="font-mono text-[12px] truncate flex-1">{session.id}</span>
                      {session.global && (
                        <span class="text-[10px] uppercase tracking-wider text-muted-foreground">
                          global
                        </span>
                      )}
                      <span class="font-mono text-[11px] text-muted-foreground truncate">
                        {session.collection}
                      </span>
                      {session.overrideCount > 0 && (
                        <span class="text-[11px] text-amber tabular-nums">
                          {`${session.overrideCount} pinned`}
                        </span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
            <Timeline />
          </>
        )}
      </div>
    </section>
  )
}
