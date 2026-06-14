import type { Selection } from '@decoy/core'

/** The `x-mock-session` header that scopes a session's selection (ADR-0011). */
export const SESSION_HEADER = 'x-mock-session'

/**
 * The transport-agnostic control interface (ADR-0011). One set of methods,
 * many transports — `SessionRouter` proxies them over `/admin`, a future
 * `PlaywrightRouter` drives the in-process engine — so test code never touches
 * transport details. Mirrors the canonical JS control API (ADR-0010): a Router's
 * `useCollection`/`useRoute`/`reset` are the async, switchable view of
 * `setCollection`/`useRoute`/`reset`. Each call resolves with the resulting
 * selection, so a switch is confirmable.
 */
export interface Router {
  /** Switch the active collection; the next request reflects it. */
  useCollection(name: string): Promise<Selection>
  /** Pin a single route's `preset` slot to `variant` within the active collection. */
  useRoute(route: string, preset: string, variant: string): Promise<Selection>
  /** Drop all per-route overrides, returning to the active collection's baseline. */
  reset(): Promise<Selection>
}
