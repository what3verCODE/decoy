import { signal } from '@preact/signals'

/** Which primary view the center area shows: the routes catalog or the sessions inspector. */
export type View = 'catalog' | 'sessions'

/** The active center view. Switched from the top bar; mutually exclusive. */
export const view = signal<View>('catalog')

export function showCatalog(): void {
  view.value = 'catalog'
}

export function showSessions(): void {
  view.value = 'sessions'
}
