import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectSourceFiles } from './collect'
import { findImpurities, type Impurity } from './purity'

/** Outcome of a purity check over a source tree. */
export type PurityResult = {
  ok: boolean
  scanned: number
  impurities: Impurity[]
}

/** Repo root, resolved from this file's location (tooling/core-purity/src → repo). */
export function repoRootFrom(metaUrl: string): string {
  return resolve(dirname(fileURLToPath(metaUrl)), '../../..')
}

/** Scan `coreSrcDir` and report any Node-built-in imports, paths relative to `repoRoot`. */
export function checkPurity(coreSrcDir: string, repoRoot: string): PurityResult {
  const files = collectSourceFiles(coreSrcDir, repoRoot)
  const impurities = findImpurities(files)
  return { ok: impurities.length === 0, scanned: files.length, impurities }
}

/**
 * Run the guard against `@decoy/core` and report through `out`. Returns the
 * process exit code: `0` when core is IO-free, `1` when any forbidden import is
 * found. Side-effect-free apart from `out`, so it is capture-testable.
 */
export function run(out: (line: string) => void = console.log): number {
  const repoRoot = repoRootFrom(import.meta.url)
  const coreSrc = join(repoRoot, 'packages', 'core', 'src')
  const { ok, scanned, impurities } = checkPurity(coreSrc, repoRoot)

  if (ok) {
    out(`@decoy/core is IO-free — scanned ${scanned} file(s), no Node built-in imports.`)
    return 0
  }

  for (const { file, line, specifier } of impurities) {
    out(
      `error: ${file}:${line} — imports Node built-in "${specifier}"; ` +
        '@decoy/core must be IO-free',
    )
  }
  out(`core purity check failed: ${impurities.length} forbidden import(s) in @decoy/core`)
  return 1
}
