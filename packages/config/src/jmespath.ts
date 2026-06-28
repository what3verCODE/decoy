import { standardFunctions } from '@decoy/core'
import type { JmespathConfig } from './define-config'
import type { ValidationIssue } from './validate'

/** Names owned by the standard JMESPath function library — a custom function may not shadow one. */
const STANDARD_NAMES = new Set(standardFunctions.map((fn) => fn.name))

/**
 * Report the semantic problems in a service's `jmespath.functions` that the schema
 * cannot: a custom name that **shadows a standard function**, and a **duplicate**
 * name within the set. Both are errors — a silent shadow would change what every
 * `${ }` expression means. The shape (name a non-empty string, `func` a function) is
 * the schema's job; this defensively skips a malformed entry and reports nothing
 * extra for it.
 */
export function validateJmespath(
  jmespath: unknown,
  file: string,
  service: string,
): ValidationIssue[] {
  if (jmespath === null || typeof jmespath !== 'object') {
    return []
  }
  const functions = (jmespath as JmespathConfig).functions
  if (!Array.isArray(functions)) {
    return []
  }

  const issues: ValidationIssue[] = []
  const seen = new Set<string>()
  for (const fn of functions) {
    const name = fn !== null && typeof fn === 'object' ? (fn as { name?: unknown }).name : undefined
    if (typeof name !== 'string' || name.length === 0) {
      continue // a shape error — the schema reports it
    }
    if (STANDARD_NAMES.has(name)) {
      issues.push({
        severity: 'error',
        message: `error in ${service}: jmespath function "${name}" collides with the standard function of the same name`,
        file,
      })
    }
    if (seen.has(name)) {
      issues.push({
        severity: 'error',
        message: `error in ${service}: duplicate jmespath function "${name}"`,
        file,
      })
    }
    seen.add(name)
  }
  return issues
}
