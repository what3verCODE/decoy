import type { JSX } from 'preact'

// method -> badge color (GET=emerald, POST=sky, PUT/PATCH=amber, DELETE=rose).
function methodColor(method: string): string {
  switch (method.toUpperCase()) {
    case 'GET':
      return 'text-emerald border-emerald/30 bg-emerald/10'
    case 'POST':
      return 'text-sky border-sky/30 bg-sky/10'
    case 'PUT':
    case 'PATCH':
      return 'text-amber border-amber/30 bg-amber/10'
    case 'DELETE':
      return 'text-rose border-rose/30 bg-rose/10'
    default:
      return 'text-muted-foreground border-border bg-muted/40'
  }
}

const pill =
  'inline-flex items-center justify-center rounded border px-1.5 h-[18px] text-[11px] font-medium leading-none tracking-wide'

export function MethodBadge({ method }: { method: string }): JSX.Element {
  // DELETE shown as DEL to stay compact.
  const label = method.toUpperCase() === 'DELETE' ? 'DEL' : method.toUpperCase()
  return <span class={`${pill} font-mono ${methodColor(method)}`}>{label}</span>
}
