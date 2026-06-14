import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { SourceFile } from './purity'

/** Whether `name` is a shippable source file (TS, excluding tests, which aren't shipped). */
function isShippableSource(name: string): boolean {
  if (name.endsWith('.test.ts') || name.endsWith('.test.tsx')) return false
  return name.endsWith('.ts') || name.endsWith('.tsx')
}

/**
 * Recursively read every shippable source file under `dir`, returning contents
 * paired with a path relative to `repoRoot` (for readable diagnostics). Test
 * files are skipped — they aren't part of the published engine. Results are
 * sorted by path so reports are deterministic.
 */
export function collectSourceFiles(dir: string, repoRoot: string): SourceFile[] {
  const files: SourceFile[] = []

  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (entry.isFile() && isShippableSource(entry.name)) {
        files.push({ file: relative(repoRoot, full), content: readFileSync(full, 'utf8') })
      }
    }
  }

  walk(dir)
  return files.sort((a, b) => a.file.localeCompare(b.file))
}
