import { type InputSignature, isRegistered, registerFunction } from '@jmespath-community/jmespath'

/** The JMESPath argument {@link InputSignature} (re-exported so a config can type a custom function's signature without depending on the JMESPath package). */
export type { InputSignature }

/** The implementation shape the JMESPath runtime expects (resolved args in, JSON out). */
type FunctionImpl = Parameters<typeof registerFunction>[1]

/**
 * One entry of the **standard JMESPath function library**: a name it is
 * invoked by, its argument {@link InputSignature} (the runtime validates arity and
 * types against it), and the pure implementation. The set is part of the
 * **cross-language contract** — a future per-language client reproduces
 * each function by name and semantics, not by sharing this code.
 *
 * The library covers what JMESPath, a *query* language, cannot: **fabricating** data
 * (random ids, timestamps, synthetic records). v1 ships `uuid` as the inaugural
 * function; the same seam registers any further standard functions and, later, a
 * config's custom functions (#34).
 */
export type StandardFunction = {
  name: string
  signature: InputSignature[]
  func: FunctionImpl
}

/**
 * `uuid()` — a freshly generated **RFC 4122 version 4** UUID as a lowercase,
 * hyphenated string (e.g. `f47ac10b-58cc-4372-a567-0e02b2c3d479`). Takes no
 * arguments and is **non-deterministic by design**: each call fabricates a new
 * value, which is the point — JMESPath alone cannot mint ids.
 */
const uuid: StandardFunction = {
  name: 'uuid',
  signature: [],
  func: () => globalThis.crypto.randomUUID(),
}

/**
 * The finalized standard-function set, evaluated by every `${ }` template and
 * preset predicate. Extend the library by adding an entry here — registration and
 * the cross-language contract flow from this one list.
 */
export const standardFunctions: StandardFunction[] = [uuid]

/**
 * Register the standard-function set into the JMESPath runtime that templating
 * evaluates against (a process-global registry in `@jmespath-community/jmespath`).
 *
 * **Idempotent:** a name already present is left untouched, so repeated calls
 * (multiple engines in one process, module re-imports) are safe and a user's custom
 * function (#34) registered under the same name is never clobbered — collisions are
 * the registrar's concern, not this function's.
 */
export function registerStandardFunctions(): void {
  for (const { name, signature, func } of standardFunctions) {
    if (!isRegistered(name)) {
      registerFunction(name, func, signature)
    }
  }
}

/**
 * A user-registered **custom JMESPath function** — the same `{ name, signature, func }`
 * shape as a {@link StandardFunction}, supplied through `defineConfig({ jmespath: {
 * functions } })`. It composes with the standard library: once registered, it is
 * callable from any `${ }` template and preset predicate. Authored in a `.ts`/`.js`
 * config only — `func` is code, and mock files stay declarative.
 */
export type CustomFunction = StandardFunction

/**
 * Register a config's {@link CustomFunction}s into the JMESPath runtime, through the
 * same seam as {@link registerStandardFunctions}.
 *
 * **Idempotent and standard-safe:** a name already registered — a standard function,
 * or a custom one from an earlier load in this process (repeated loads, hot reload) —
 * is left untouched, so the standard library is never clobbered and a re-register
 * never throws. Collision *reporting* (a custom name that shadows a standard function,
 * or a duplicate within the set) is the config layer's job: it surfaces those as
 * load-time validation errors before this runs. A signature the runtime rejects is
 * rethrown with the offending function named.
 */
export function registerCustomFunctions(functions: CustomFunction[]): void {
  for (const { name, signature, func } of functions) {
    if (isRegistered(name)) {
      continue
    }
    try {
      registerFunction(name, func, signature)
    } catch (error) {
      throw new Error(
        `decoy: failed to register custom JMESPath function "${name}": ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }
}
