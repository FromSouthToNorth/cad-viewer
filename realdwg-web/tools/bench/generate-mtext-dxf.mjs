#!/usr/bin/env node
/**
 * Generate MTEXT-heavy DXF fixtures for M4-1 glyph-cache integration tests.
 *
 * Two fixture kinds:
 *  - `duplicate`: every MTEXT shares identical content / style / color, so a
 *    content-level glyph cache should serve all entities after the first.
 *  - `unique`: every MTEXT has distinct content (cache misses by design).
 *
 * Both write identical entity structure (same count, positions, style,
 * color) so the only variable between runs is text content.
 *
 * Usage:
 *   node tools/bench/generate-mtext-dxf.mjs <duplicate|unique> [count] [outfile]
 *
 * Defaults: 10000 MTEXT, tools/bench/fixtures/mtext-<kind>-10000.dxf
 */
import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const toolsDir = dirname(fileURLToPath(import.meta.url))

const kind = process.argv[2] ?? 'duplicate'
if (kind !== 'duplicate' && kind !== 'unique') {
  console.error('Usage: node generate-mtext-dxf.mjs <duplicate|unique> [count] [outfile]')
  process.exit(1)
}

const count = Number(process.argv[3] ?? 10000)
const outFile =
  process.argv[4] ?? join(toolsDir, 'fixtures', `mtext-${kind}-${count}.dxf`)

const DUPLICATE_CONTENT = 'FLANGE PLATE DWG NOTE 07 - REFER TO ISO 965-1'

function contentFor(i) {
  if (kind === 'duplicate') return DUPLICATE_CONTENT
  return `unique annotation entry #${String(i).padStart(5, '0')} reference`
}

function fmt(n) {
  return n.toFixed(4)
}

await mkdir(dirname(outFile), { recursive: true })
const stream = createWriteStream(outFile)

function write(text) {
  stream.write(text)
}

write(
  '0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1021\n' +
    '9\n$DWGCODEPAGE\n3\nUTF-8\n0\nENDSEC\n'
)
write(
  '0\nSECTION\n2\nTABLES\n' +
    '0\nTABLE\n2\nLTYPE\n70\n1\n0\nLTYPE\n2\nCONTINUOUS\n70\n0\n' +
    '3\nSolid line\n72\n65\n73\n0\n40\n0.0\n0\nENDTAB\n' +
    '0\nTABLE\n2\nLAYER\n70\n1\n' +
    '0\nLAYER\n2\n0\n70\n0\n62\n7\n6\nCONTINUOUS\n370\n-1\n' +
    '0\nENDTAB\n' +
    '0\nTABLE\n2\nSTYLE\n70\n1\n' +
    '0\nSTYLE\n2\nStandard\n70\n0\n40\n0.0\n41\n1.0\n50\n0.0\n' +
    '71\n0\n42\n2.5\n3\ntxt\n4\n\n0\nENDTAB\n0\nENDSEC\n'
)
write('0\nSECTION\n2\nBLOCKS\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n')

const grid = Math.ceil(Math.sqrt(count))
for (let i = 0; i < count; i++) {
  const col = i % grid
  const row = Math.floor(i / grid)
  const x = col * 20
  const y = row * 20
  const handle = (0x100 + i).toString(16).toUpperCase()
  const content = contentFor(i)
  write(
    `0\nMTEXT\n5\n${handle}\n330\n1F\n100\nAcDbEntity\n8\n0\n` +
      `100\nAcDbMText\n10\n${fmt(x)}\n20\n${fmt(y)}\n30\n0.0\n` +
      `40\n2.5\n41\n0.0\n71\n1\n72\n5\n1\n${content}\n` +
      `7\nStandard\n73\n1\n50\n0.0\n`
  )
}

write('0\nENDSEC\n0\nEOF\n')

await new Promise((resolve, reject) => {
  stream.end(err => (err ? reject(err) : resolve()))
})

console.log(`wrote ${outFile} (${count} MTEXT, kind=${kind})`)
