import type { PresetFieldTrace, TraceStep } from '@decoy/core'
import type { JSX } from 'preact'
import { useMemo, useState } from 'preact/hooks'
import { EXAMPLE, run } from './run'

/** The status glyph for a trace step — passed, or a dead end / miss. */
function glyph(ok: boolean): string {
  return ok ? '✓' : '✗'
}

function compact(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

/** The per-condition breakdown shown under a `preset` step, so a failure says what didn't match. */
function FieldRows({ fields }: { fields: PresetFieldTrace[] }): JSX.Element {
  return (
    <ul class="pg-fields">
      {fields.map((field) => (
        <li key={field.field} class={`pg-field ${field.matched ? 'pg-field--ok' : 'pg-field--no'}`}>
          <span class="pg-field__glyph" aria-hidden="true">
            {glyph(field.matched)}
          </span>
          <span class="pg-field__name">{field.field}</span>
          {field.matched ? (
            <span class="pg-field__detail">matched</span>
          ) : (
            <span class="pg-field__detail">
              expected <code>{compact(field.expected)}</code> · got{' '}
              <code>{compact(field.actual)}</code>
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}

function TraceRow({ step }: { step: TraceStep }): JSX.Element {
  const fields = step.kind === 'preset' ? step.fields : undefined
  return (
    <li class={`pg-step ${step.ok ? 'pg-step--ok' : 'pg-step--no'}`}>
      <div class="pg-step__row">
        <span class="pg-step__glyph" aria-hidden="true">
          {glyph(step.ok)}
        </span>
        <span class="pg-step__kind">{step.kind}</span>
        <span class="pg-step__detail">{step.detail}</span>
      </div>
      {fields && fields.length > 0 && <FieldRows fields={fields} />}
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

  // Make Tab indent (2 spaces) instead of moving focus; Shift+Tab outdents the line.
  const onKeyDown = (event: JSX.TargetedKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Tab') {
      return
    }
    event.preventDefault()
    const ta = event.currentTarget
    const { selectionStart, selectionEnd, value } = ta
    if (event.shiftKey) {
      const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1
      const lead = value.slice(lineStart).match(/^ {1,2}/)?.[0] ?? ''
      if (!lead) {
        return
      }
      const next = value.slice(0, lineStart) + value.slice(lineStart + lead.length)
      const caret = Math.max(lineStart, selectionStart - lead.length)
      ta.value = next
      ta.selectionStart = ta.selectionEnd = caret
      setText(next)
    } else {
      const indent = '  '
      const next = value.slice(0, selectionStart) + indent + value.slice(selectionEnd)
      const caret = selectionStart + indent.length
      ta.value = next
      ta.selectionStart = ta.selectionEnd = caret
      setText(next)
    }
  }

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
            onKeyDown={onKeyDown}
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
