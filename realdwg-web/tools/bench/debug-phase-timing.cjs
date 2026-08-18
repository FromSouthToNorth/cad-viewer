#!/usr/bin/env node
/**
 * Bisect helper: time each synchronous phase of opening a DXF to find stalls.
 *
 * Usage:
 *   node tools/bench/debug-phase-timing.cjs <file.dxf> [maxPairs]
 */
'use strict'

const { readFile } = require('node:fs/promises')
const {
  AcDbDxfFiler,
  acdbCreateDxfPairReader,
  acdbPeekDxfHeaderInfo,
  acdbIsBinaryDxf
} = require('@mlightcad/data-model')

async function main() {
  const file = process.argv[2]
  const maxPairs = Number(process.argv[3] ?? 200000)
  const buffer = await readFile(file)
  const bytes = new Uint8Array(buffer)
  const t0 = Date.now()
  const mark = (label) => {
    console.log(`[${((Date.now() - t0) / 1000).toFixed(2)}s] ${label}`)
  }
  mark('start')

  mark(`binary? ${acdbIsBinaryDxf(bytes)}`)
  const info = acdbPeekDxfHeaderInfo(buffer)
  mark(`header info: version=${info.version?.toString?.() ?? info.version} encoding=${info.encoding}`)

  // Force the same resolution acdbCreateDxfPairReader uses.
  const reader = acdbCreateDxfPairReader(buffer)
  mark(`pair reader created: ${reader.kind}`)

  let count = 0
  let lastCode = 0
  let lastType = ''
  while (count < maxPairs) {
    const pair = reader.next()
    if (!pair) break
    count++
    lastCode = pair.code
    lastType = pair.type
    if (count % 500000 === 0) {
      mark(`scanned ${count} pairs (code ${lastCode}, ${lastType})`)
    }
  }
  mark(`scanned ${count} pairs, last code ${lastCode} (${lastType})`)

  const filer = AcDbDxfFiler.fromBuffer(buffer)
  mark('filer created')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
