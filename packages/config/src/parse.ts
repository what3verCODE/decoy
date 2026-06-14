import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { parse as parseYaml } from 'yaml'

/** Extensions treated as declarative mock files. */
export const MOCK_EXTENSIONS = new Set(['.yaml', '.yml', '.json'])

/** Parse a declarative YAML/JSON mock file into a plain object/array. */
export async function parseDataFile(filePath: string): Promise<unknown> {
  const raw = await readFile(filePath, 'utf8')
  const ext = extname(filePath).toLowerCase()
  if (ext === '.json') {
    return JSON.parse(raw)
  }
  return parseYaml(raw)
}
