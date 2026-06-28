import type { TraceStep } from '@decoy/core'
import type { JSX } from 'preact'
import { useMemo, useState } from 'preact/hooks'
import { EXAMPLE, run } from './run'

/** The status glyph for a trace step — passed, or a dead end / miss. */
function glyph(ok: boolean): string {
  return ok ? '✓' : '✗'
}

function TraceRow({ step }: { step: TraceStep }): JSX.Element {
  return (
    <li class={`pg-step ${step.ok ? 'pg-step--ok' : 'pg-step--no'}`}>
      <span class="pg-step__glyph" aria-hidden="true">
        {glyph(step.ok)}
      </span>
      <span class="pg-step__kind">{step.kind}</span>
      <span class="pg-step__detail">{step.detail}</span>
    </li>
  )
}

function Result({ text }: { text: string }): JSX.Element {
  const result = useMemo(() => run(text), [text])

  if (!result.ok) {
    return <p class="pg-error">{result.error}</p>
  }

  const { plan, resolution, steps } = result
  const matched = !resolution.startsWith('MISS(')
  return (
    <>
      <div class="pg-resline">
        <span class="pg-tag">resolution</span>
        <code class={`pg-res ${matched ? 'pg-res--ok' : 'pg-res--miss'}`}>{resolution}</code>
        <span class="pg-status">{plan.status}</span>
      </div>

      <h3 class="pg-h3">Response</h3>
      <pre class="pg-pre">{headerLines(plan.headers)}</pre>
      <pre class="pg-pre">{plan.body ?? '(no body)'}</pre>

      <h3 class="pg-h3">How the engine resolved it</h3>
      <ol class="pg-trace">
        {steps.map((step, index) => (
          <TraceRow key={`${index}-${step.kind}`} step={step} />
        ))}
      </ol>
    </>
  )
}

function headerLines(headers: Record<string, string>): string {
  const entries = Object.entries(headers)
  return entries.length === 0
    ? '(no headers)'
    : entries.map(([name, value]) => `${name}: ${value}`).join('\n')
}

export function App(): JSX.Element {
  const [text, setText] = useState(EXAMPLE)
  return (
    <div class="pg">
      <header class="pg-bar">
        <span class="pg-brand">decoy</span>
        <span class="pg-sub">playground</span>
        <span class="pg-note">runs the real @decoy/core engine in your browser — no server</span>
      </header>
      <main class="pg-panes">
        <section class="pg-pane pg-pane--left">
          <h2 class="pg-h2">Editor · YAML / JSON</h2>
          <textarea
            class="pg-editor"
            spellcheck={false}
            value={text}
            onInput={(event) => setText((event.currentTarget as HTMLTextAreaElement).value)}
          />
        </section>
        <section class="pg-pane pg-pane--right">
          <h2 class="pg-h2">Result</h2>
          <div class="pg-result">
            <Result text={text} />
          </div>
        </section>
      </main>
    </div>
  )
}
