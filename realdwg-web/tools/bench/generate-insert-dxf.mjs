#!/usr/bin/env node
/**
 * Generate an INSERT-heavy DXF fixture for M5-3 rendering-cache profiling.
 *
 * Defines one block (BOLT: 8 lines + a circle) and places many INSERTs in
 * model space. 90% of INSERTs use uniform scale 1.0 (template-sharing
 * scenario), 10% use scale 2.0 so some template misses still occur.
 *
 * Usage:
 *   node tools/bench/generate-insert-dxf.mjs [count] [outfile]
 *
 * Defaults: 50000 INSERTs, tools/bench/fixtures/insert-blocks-50000.dxf
 */
import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const toolsDir = dirname(fileURLToPath(import.meta.url))
const defaultOutFile = join(toolsDir, 'fixtures', 'insert-blocks-50000.dxf')

const count = Number(process.argv[2] ?? 50000)
const outFile = process.argv[3] ?? defaultOutFile

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
    '0\nENDTAB\n0\nENDSEC\n'
)

// Block definition: a small bolt-ish shape (8 lines + 1 circle).
write(
  '0\nSECTION\n2\nBLOCKS\n0\nBLOCK\n5\n20\n330\n1F\n100\nAcDbEntity\n8\n0\n' +
    '100\nAcDbBlockBegin\n2\nBOLT\n70\n0\n10\n0.0\n20\n0.0\n30\n0.0\n3\nBOLT\n1\n\n'
)
for (let i = 0; i < 8; i++) {
  const a = (i / 8) * Math.PI * 2
  const b = ((i + 1) / 8) * Math.PI * 2
  write(
    `0\nLINE\n5\n${(0x30 + i).toString(16).toUpperCase()}\n330\n20\n100\nAcDbEntity\n8\n0\n` +
      `100\nAcDbLine\n10\n${fmt(Math.cos(a) * 5)}\n20\n${fmt(Math.sin(a) * 5)}\n30\n0.0\n` +
      `11\n${fmt(Math.cos(b) * 5)}\n21\n${fmt(Math.sin(b) * 5)}\n31\n0.0\n`
  )
}
write(
  '0\nCIRCLE\n5\n38\n330\n20\n100\nAcDbEntity\n8\n0\n100\nAcDbCircle\n' +
    '10\n0.0\n20\n0.0\n30\n0.0\n40\n5.0\n'
)
write('0\nENDBLK\n5\n39\n330\n1F\n100\nAcDbEntity\n8\n0\n100\nAcDbBlockEnd\n')
write('0\nENDSEC\n0\nSECTION\n2\nENTITIES\n')

const grid = Math.ceil(Math.sqrt(count))
for (let i = 0; i < count; i++) {
  const col = i % grid
  const row = Math.floor(i / grid)
  const x = col * 30
  const y = row * 30
  const scale = i % 10 === 0 ? 2.0 : 1.0
  const handle = (0x100 + i).toString(16).toUpperCase()
  write(
    `0\nINSERT\n5\n${handle}\n330\n1F\n100\nAcDbEntity\n8\n0\n100\nAcDbBlockReference\n` +
      `2\nBOLT\n10\n${fmt(x)}\n20\n${fmt(y)}\n30\n0.0\n` +
      `41\n${fmt(scale)}\n42\n${fmt(scale)}\n43\n${fmt(scale)}\n50\n0.0\n`
  )
}

write('0\nENDSEC\n0\nEOF\n')

await new Promise((resolve, reject) => {
  stream.end(err => (err ? reject(err) : resolve()))
})

console.log(`wrote ${outFile} (${count} INSERT of BOLT)`)
