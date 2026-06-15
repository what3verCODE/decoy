import type { JSX } from 'preact'
import type { RoutePreset, RouteVariant } from '../api'
import {
  closeRoute,
  detail,
  runTry,
  tryBody,
  tryLoad,
  tryMethod,
  tryPath,
} from '../model/route-detail'
import { MethodBadge, StatusBadge } from './badges'

/** Render a value as pretty JSON for the presets/variants/response readouts. */
function json(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function PresetRow({ name, preset }: { name: string; preset: RoutePreset }): JSX.Element {
  const isCatchAll = Object.keys(preset).length === 0
  return (
    <li data-testid="preset-row" class="px-4 py-1.5 border-b border-border/60">
      <div class="flex items-center gap-2">
        <span class="font-mono text-[12px] text-foreground">{name}</span>
        {isCatchAll && (
          <span class="text-[10px] uppercase tracking-wider text-muted-foreground">catch-all</span>
        )}
      </div>
      {!isCatchAll && (
        <pre class="mt-1 font-mono text-[11px] text-muted-foreground whitespace-pre-wrap break-words">
          {json(preset)}
        </pre>
      )}
    </li>
  )
}

function VariantRow({ name, variant }: { name: string; variant: RouteVariant }): JSX.Element {
  return (
    <li data-testid="variant-row" class="px-4 py-1.5 border-b border-border/60">
      <div class="flex items-center gap-2">
        <span class="font-mono text-[12px] text-foreground">{name}</span>
        <StatusBadge status={variant.status ?? 200} />
      </div>
      {variant.body !== undefined && (
        <pre class="mt-1 font-mono text-[11px] text-muted-foreground whitespace-pre-wrap break-words">
          {json(variant.body)}
        </pre>
      )}
    </li>
  )
}

function Playground(): JSX.Element {
  const result = tryLoad.value
  return (
    <div data-testid="playground" class="border-t border-border">
      <div class="flex items-center h-7 px-4">
        <h3 class="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Playground
        </h3>
      </div>
      <div class="px-4 pb-3 flex flex-col gap-2">
        <div class="flex gap-2">
          <input
            data-testid="playground-method"
            value={tryMethod.value}
            onInput={(event) => {
              tryMethod.value = (event.currentTarget as HTMLInputElement).value
            }}
            class="w-20 font-mono text-[12px] px-2 h-7 rounded border border-border bg-background text-foreground"
          />
          <input
            data-testid="playground-path"
            value={tryPath.value}
            onInput={(event) => {
              tryPath.value = (event.currentTarget as HTMLInputElement).value
            }}
            class="flex-1 min-w-0 font-mono text-[12px] px-2 h-7 rounded border border-border bg-background text-foreground"
          />
          <button
            type="button"
            data-testid="playground-send"
            onClick={() => void runTry()}
            class="text-[12px] px-3 h-7 rounded border border-border text-foreground hover:bg-muted/60 transition-colors"
          >
            send
          </button>
        </div>
        <textarea
          data-testid="playground-body"
          value={tryBody.value}
          onInput={(event) => {
            tryBody.value = (event.currentTarget as HTMLTextAreaElement).value
          }}
          rows={2}
          placeholder="request body (JSON, optional)"
          class="font-mono text-[11px] px-2 py-1 rounded border border-border bg-background text-foreground resize-y"
        />
        {result.state === 'loading' && <p class="text-muted-foreground text-[12px]">resolving…</p>}
        {result.state === 'error' && (
          <p data-testid="playground-error" class="text-rose text-[12px]">
            {result.message}
          </p>
        )}
        {result.state === 'ready' && (
          <div class="flex flex-col gap-1">
            <div class="flex items-center gap-2">
              <span class="text-[10px] uppercase tracking-wider text-muted-foreground">
                resolution
              </span>
              <span
                data-testid="playground-resolution"
                class="font-mono text-[12px] text-foreground"
              >
                {result.result.resolution}
              </span>
              {result.result.response && <StatusBadge status={result.result.response.status} />}
            </div>
            <pre
              data-testid="playground-response"
              class="font-mono text-[11px] text-muted-foreground whitespace-pre-wrap break-words"
            >
              {result.result.response
                ? json(result.result.response.body)
                : 'forwarded to passthrough (no dry-run body)'}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}

export function RouteDetail(): JSX.Element {
  const current = detail.value
  return (
    <section class="flex-1 min-w-0 flex flex-col overflow-hidden" data-testid="route-detail">
      <div class="flex items-center gap-2 h-9 px-4 border-b border-border shrink-0">
        <button
          type="button"
          data-testid="route-detail-back"
          onClick={closeRoute}
          class="text-[11px] px-1.5 h-[18px] rounded border border-border text-muted-foreground hover:bg-muted/60 transition-colors"
        >
          ← routes
        </button>
        {current.state === 'ready' && (
          <>
            <MethodBadge method={current.route.method} />
            <span class="font-mono text-[12px] text-foreground">{current.route.path}</span>
            <span class="font-mono text-[12px] text-muted-foreground">{current.route.id}</span>
          </>
        )}
      </div>
      <div class="overflow-y-auto flex-1">
        {current.state === 'loading' && (
          <p class="px-4 py-6 text-muted-foreground text-[12px]">loading route…</p>
        )}
        {current.state === 'error' && (
          <p class="px-4 py-6 text-rose text-[12px]" data-testid="route-detail-error">
            {current.message}
          </p>
        )}
        {current.state === 'ready' && (
          <>
            <div class="flex items-center h-7 px-4">
              <h3 class="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Presets
              </h3>
            </div>
            <ul>
              {Object.entries(current.route.presets).map(([name, preset]) => (
                <PresetRow key={name} name={name} preset={preset} />
              ))}
            </ul>
            <div class="flex items-center h-7 px-4 mt-1">
              <h3 class="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Variants
              </h3>
            </div>
            <ul>
              {Object.entries(current.route.variants).map(([name, variant]) => (
                <VariantRow key={name} name={name} variant={variant} />
              ))}
            </ul>
            <Playground />
          </>
        )}
      </div>
    </section>
  )
}
