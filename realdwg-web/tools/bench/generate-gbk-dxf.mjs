#!/usr/bin/env node
/**
 * Generate a GBK (ANSI_936) DXF fixture for windowed-decode benchmarks.
 *
 * Writes raw bytes: ASCII passes through unchanged (GBK is an ASCII
 * superset for bytes < 0x80); the small set of Chinese characters used in
 * layer names / text values is emitted via hardcoded GBK sequences.
 *
 * Usage:
 *   node tools/bench/generate-gbk-dxf.mjs [count] [outfile]
 *
 * Defaults: 300000 lines, tools/bench/fixtures/gbk-lines-300000.dxf
 */
import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const toolsDir = dirname(fileURLToPath(import.meta.url))
const defaultOutFile = join(toolsDir, 'fixtures', 'gbk-lines-300000.dxf')

const GBK = {
  图: [0xcd, 0xbc],
  层: [0xb2, 0xe3],
  测: [0xb2, 0xe2],
  量: [0xc1, 0xbf],
  道: [0xb5, 0xc0],
  路: [0xc2, 0xb7]
}

function gbkBytes(text) {
  const out = []
  for (const ch of text) {
    const seq = GBK[ch]
    if (seq) out.push(...seq)
    else out.push(ch.charCodeAt(0))
  }
  return Buffer.from(out)
}

function makeRandom(seed) {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0xffffffff
  }
}

const rand = makeRandom(0xbadc0de)

function fmt(n) {
  return n.toFixed(4)
}

const count = Number(process.argv[2] ?? 300000)
const outFile = process.argv[3] ?? defaultOutFile

await mkdir(dirname(outFile), { recursive: true })
const stream = createWriteStream(outFile)

function write(text) {
  stream.write(gbkBytes(text))
}

write(
  '0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1015\n' +
    '9\n$DWGCODEPAGE\n3\nANSI_936\n0\nENDSEC\n'
)
write(
  '0\nSECTION\n2\nTABLES\n' +
    '0\nTABLE\n2\nLTYPE\n70\n1\n0\nLTYPE\n2\nCONTINUOUS\n70\n0\n' +
    '3\nSolid line\n72\n65\n73\n0\n40\n0.0\n0\nENDTAB\n' +
    '0\nTABLE\n2\nLAYER\n70\n2\n' +
    '0\nLAYER\n2\n0\n70\n0\n62\n7\n6\nCONTINUOUS\n370\n-1\n' +
    '0\nLAYER\n2\n图层\n70\n0\n62\n3\n6\nCONTINUOUS\n370\n-1\n' +
    '0\nENDTAB\n0\nENDSEC\n'
)
write('0\nSECTION\n2\nBLOCKS\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n')

for (let i = 0; i < count; i++) {
  const x1 = rand() * 100000
  const y1 = rand() * 100000
  const layer = i % 2 === 0 ? '0' : '图层'
  write(
    `0\nLINE\n8\n${layer}\n10\n${fmt(x1)}\n20\n${fmt(y1)}\n30\n0.0\n` +
      `11\n${fmt(x1 + 10)}\n21\n${fmt(y1 + 5)}\n31\n0.0\n`
  )
  if (i % 100 === 0) {
    write(
      `0\nTEXT\n8\n${layer}\n10\n${fmt(x1)}\n20\n${fmt(y1)}\n30\n0.0\n` +
        `40\n2.5\n1\n测量道路\n`
    )
  }
}

write('0\nENDSEC\n0\nEOF\n')

await new Promise((resolve, reject) => {
  stream.end(err => (err ? reject(err) : resolve()))
})
console.log(`wrote ${outFile} (${count} lines, GBK/ANSI_936)`)
