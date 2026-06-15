import { computed, signal } from '@preact/signals'
import type { JSX } from 'preact'
import {
  connectLogs,
  fetchRoutes,
  type LogStream,
  type RequestLogRecord,
  type RouteCatalogEntry,
  resolutionOf,
} from './api'
import { MethodBadge, StatusBadge } from './badges'

type Load =
  | { state: 'loading' }
  | { state: 'ready'; routes: RouteCatalogEntry[] }
  | { state: 'error'; message: string }

const load = signal<Load>({ state: 'loading' })
const routeCount = computed(() => (load.value.state === 'ready' ? load.value.routes.length : 0))

/** Fetch the routes catalog into the `load` signal — called once on boot. */
export async function loadRoutes(): Promise<void> {
  load.value = { state: 'loading' }
  try {
    load.value = { state: 'ready', routes: await fetchRoutes() }
  } catch (error) {
    load.value = { state: 'error', message: error instanceof Error ? error.message : String(error) }
  }
}

/** Most recent records first; bounded so a long session can't grow unboundedly. */
const MAX_LOG_ROWS = 500
const logs = signal<RequestLogRecord[]>([])
const paused = signal(false)
const logCount = computed(() => logs.value.length)
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

function clearLogs(): void {
  logs.value = []
  pausedBuffer = []
}

function togglePause(): void {
  paused.value = !paused.value
  if (!paused.value && pausedBuffer.length > 0) {
    prepend(pausedBuffer)
    pausedBuffer = []
  }
}

function TopBar(): JSX.Element {
  return (
    <header class="flex items-center gap-3 h-12 px-4 border-b border-border bg-card shrink-0">
      <span class="font-semibold tracking-tight text-foreground select-none">decoy</span>
      <span class="text-[11px] uppercase tracking-wider text-muted-foreground px-1.5 py-0.5 rounded bg-muted">
        control panel
      </span>
      <div class="flex-1" />
      <span class="text-muted-foreground">
        <span class="text-foreground tabular-nums">{routeCount.value}</span> routes
      </span>
    </header>
  )
}

function RoutesCatalog(): JSX.Element {
  const current = load.value
  return (
    <section class="flex-1 min-w-0 flex flex-col overflow-hidden" data-testid="routes-catalog">
      <div class="flex items-center h-9 px-4 border-b border-border shrink-0">
        <h2 class="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Routes Catalog
        </h2>
      </div>
      <div class="overflow-y-auto flex-1">
        {current.state === 'loading' && (
          <p class="px-4 py-6 text-muted-foreground text-[12px]">loading routes…</p>
        )}
        {current.state === 'error' && (
          <p class="px-4 py-6 text-rose text-[12px]" data-testid="routes-error">
            {current.message}
          </p>
        )}
        {current.state === 'ready' && current.routes.length === 0 && (
          <p class="px-4 py-6 text-muted-foreground text-[12px]">no routes defined</p>
        )}
        {current.state === 'ready' && current.routes.length > 0 && (
          <table class="w-full border-collapse">
            <thead class="sticky top-0 bg-card z-10">
              <tr class="text-[10px] uppercase tracking-wider text-muted-foreground text-left">
                <th class="font-medium px-4 py-1.5 w-16">method</th>
                <th class="font-medium px-2 py-1.5">path</th>
                <th class="font-medium px-2 py-1.5">id</th>
                <th class="font-medium px-2 py-1.5 w-20 text-right">presets</th>
                <th class="font-medium px-4 py-1.5 w-20 text-right">variants</th>
              </tr>
            </thead>
            <tbody>
              {current.routes.map((route) => (
                <tr
                  key={route.id}
                  data-testid="route-row"
                  class="border-b border-border/60 hover:bg-muted/60 transition-colors"
                >
                  <td class="px-4 py-1.5">
                    <MethodBadge method={route.method} />
                  </td>
                  <td class="px-2 py-1.5 font-mono text-[12px] text-foreground">{route.path}</td>
                  <td class="px-2 py-1.5 font-mono text-[12px] text-muted-foreground">
                    {route.id}
                  </td>
                  <td class="px-2 py-1.5 font-mono text-[12px] text-foreground text-right tabular-nums">
                    {route.presetCount}
                  </td>
                  <td class="px-4 py-1.5 font-mono text-[12px] text-foreground text-right tabular-nums">
                    {route.variantCount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  )
}

function LiveStream(): JSX.Element {
  const records = logs.value
  return (
    <section
      class="w-1/2 min-w-0 flex flex-col overflow-hidden border-l border-border"
      data-testid="live-stream"
    >
      <div class="flex items-center gap-2 h-9 px-4 border-b border-border shrink-0">
        <h2 class="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Live Requests
        </h2>
        <span class="text-[11px] text-muted-foreground tabular-nums">{logCount.value}</span>
        <div class="flex-1" />
        <button
          type="button"
          onClick={togglePause}
          data-testid="logs-pause"
          class="text-[11px] px-1.5 h-[18px] rounded border border-border text-muted-foreground hover:bg-muted/60 transition-colors"
        >
          {paused.value ? 'resume' : 'pause'}
        </button>
        <button
          type="button"
          onClick={clearLogs}
          data-testid="logs-clear"
          class="text-[11px] px-1.5 h-[18px] rounded border border-border text-muted-foreground hover:bg-muted/60 transition-colors"
        >
          clear
        </button>
      </div>
      <div class="overflow-y-auto flex-1">
        {records.length === 0 && (
          <p class="px-4 py-6 text-muted-foreground text-[12px]">waiting for requests…</p>
        )}
        {records.length > 0 && (
          <table class="w-full border-collapse">
            <thead class="sticky top-0 bg-card z-10">
              <tr class="text-[10px] uppercase tracking-wider text-muted-foreground text-left">
                <th class="font-medium px-4 py-1.5 w-16">method</th>
                <th class="font-medium px-2 py-1.5">path</th>
                <th class="font-medium px-2 py-1.5">resolution</th>
                <th class="font-medium px-2 py-1.5 w-14 text-right">status</th>
                <th class="font-medium px-2 py-1.5 w-16 text-right">latency</th>
                <th class="font-medium px-4 py-1.5 w-24">session</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => {
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
                    <td class="px-4 py-1.5 font-mono text-[12px] text-muted-foreground truncate">
                      {record.session}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  )
}

export function App(): JSX.Element {
  return (
    <div class="h-full flex flex-col bg-background text-foreground">
      <TopBar />
      <div class="flex-1 flex min-h-0">
        <RoutesCatalog />
        <LiveStream />
      </div>
    </div>
  )
}
