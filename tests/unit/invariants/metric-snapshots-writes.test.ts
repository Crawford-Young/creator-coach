// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Rule under test (CLAUDE.md, "Connector conventions"): metricSnapshots is a
// native time-series collection — NO upserts, NO unique indexes. Writers are
// insert-only; idempotency is query-before-insert in the writer. This is a
// source scan because the failure is "someone adds an upsert", which no
// behavioural test of today's writers would notice.

const ROOT = resolve(__dirname, '../../..')
const SCANNED_DIRS = ['src', 'scripts']
const ALLOWED_METHODS = new Set([
  'insertOne',
  'insertMany',
  'find',
  'findOne',
  'aggregate',
  'countDocuments',
  'distinct',
])

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx|mjs|js)$/.test(name) ? [path] : []
  })
}

const files = SCANNED_DIRS.flatMap((dir) => sourceFiles(join(ROOT, dir))).map((path) => ({
  path: relative(ROOT, path),
  text: readFileSync(path, 'utf8'),
}))

describe('metricSnapshots write path', () => {
  it('scans a non-empty set of files that actually write snapshots', () => {
    const writers = files.filter((file) => /metricSnapshots\s*\.\s*insert/.test(file.text))
    expect(writers.length).toBeGreaterThan(0)
  })

  it('only ever inserts or reads — no update, replace, upsert or bulkWrite', () => {
    const violations = files.flatMap((file) =>
      [...file.text.matchAll(/metricSnapshots\s*\.\s*(\w+)\s*[(<]/g)]
        .map((match) => match[1])
        .filter((method) => !ALLOWED_METHODS.has(method))
        .map((method) => `${file.path}: metricSnapshots.${method}`),
    )
    expect(violations).toEqual([])
  })

  it('never creates an index on metricSnapshots', () => {
    const violations = files
      .filter((file) =>
        /(metricSnapshots|collection\(\s*['"]metricSnapshots['"]\s*\))\s*\.\s*createIndex/.test(
          file.text,
        ),
      )
      .map((file) => file.path)
    expect(violations).toEqual([])
  })
})
