#!/usr/bin/env node
/**
 * One-off differential: streams every pair from the OLD (pre-span) reader
 * bundle and the NEW (span-based) reader and asserts per-pair equality on
 * real fixtures.
 *
 * Usage:
 *   node tools/bench/diff-old-new-reader.cjs <old-bundle-path> <file.dxf> [...]
 *
 * The old bundle is expected to be a snapshot of dist/data-model.cjs taken
 * before the span-based rewrite; the new bundle is resolved from the workspace
 * package (@mlightcad/data-model).
 */
'use strict'

const { readFileSync } = require('node:fs')
const { createRequire } = require('node:module')

const req = createRequire(__filename)
const oldPath = process.argv[2]
const files = process.argv.slice(3)
if (!oldPath || files.length === 0) {
  console.error(
    'Usage: node diff-old-new-reader.cjs <old-bundle-path> <file.dxf> [...]'
  )
  process.exit(1)
}

const oldDm = req(oldPath)
const newDm = req('@mlightcad/data-model')

function valuesEqual(a, b) {
  if (a instanceof Uint8Array || b instanceof Uint8Array) {
    return (
      a instanceof Uint8Array &&
      b instanceof Uint8Array &&
      Buffer.from(a).equals(Buffer.from(b))
    )
  }
  // Strict === (NaN never occurs: both sides map non-finite to 0).
  return a === b
}

function diffOne(file, oldReader, newReader) {
  let count = 0
  let mismatches = 0
  for (;;) {
    const a = oldReader.next()
    const b = newReader.next()
    if (a === undefined && b === undefined) break
    if (a === undefined || b === undefined) {
      console.error(
        `[${file}] length mismatch at pair #${count}: old=${a === undefined ? 'EOF' : 'pair'}, new=${b === undefined ? 'EOF' : 'pair'}`
      )
      mismatches++
      break
    }
    if (a.code !== b.code || a.type !== b.type || !valuesEqual(a.value, b.value)) {
      if (mismatches < 10) {
        console.error(
          `[${file}] pair #${count} mismatch:`,
          { code: a.code, type: a.type, value: a.value },
          '!=',
          { code: b.code, type: b.type, value: b.value }
        )
      }
      mismatches++
    }
    count++
  }
  return { count, mismatches }
}

let failed = false
for (const file of files) {
  const bytes = new Uint8Array(readFileSync(file))
  // Windowed/auto-detected path.
  const r1 = diffOne(
    file,
    oldDm.acdbCreateDxfPairReader(bytes),
    newDm.acdbCreateDxfPairReader(bytes)
  )
  // Full-text ascii reader on the same bytes (decoded as UTF-8, the common
  // label); exercises the non-windowed readRaw path.
  const text = new TextDecoder('utf-8').decode(bytes)
  const r2 = diffOne(
    file + ' (full-text)',
    oldDm.acdbMakeAsciiDxfPairReader(text),
    newDm.acdbMakeAsciiDxfPairReader(text)
  )
  const total = r1.mismatches + r2.mismatches
  console.log(
    `${file}: ${r1.count}/${r2.count} pairs, ${total} mismatches`
  )
  if (total > 0) failed = true
}

process.exit(failed ? 1 : 0)
