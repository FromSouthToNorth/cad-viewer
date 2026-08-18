#!/usr/bin/env node
/**
 * Generates a moderate DXF fixture at Gauss-Krüger-scale coordinates
 * (|x|/|y| ~ 3.965e7, some Z up to 1.973e7) that exercises every build-time
 * origin-shift path:
 *
 *  - LINE / CIRCLE       -> rebased line geometry (double -> local float32)
 *  - LWPOLYLINE (width)  -> wide-polyline fill via renderer.area()
 *  - SOLID               -> ShapeGeometry fill path (AcTrPolygon)
 *  - 3DFACE              -> lineSegments Float64Array path (AcDbFace),
 *                           including faces elevated at Z ~ 1.97e7
 *
 * Fractional coordinate detail (e.g. +0.3) is below the float32 ulp (4) at
 * this magnitude, so a world-space-baked builder would quantize it away.
 *
 * Usage:
 *   node tools/bench/generate-origin-shift-dxf.mjs [outfile]
 */
import { createWriteStream } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const toolsDir = dirname(fileURLToPath(import.meta.url))
const defaultOut = join(toolsDir, 'fixtures', 'origin-shift.dxf')

const BASE_X = 39652926.8
const BASE_Y = 39458238.4
const HIGH_Z = 19730366.2

function makeRandom(seed) {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0xffffffff
  }
}
const rand = makeRandom(0xdecaf)

const fmt = n => n.toFixed(4)

const header =
  '0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1015\n0\nENDSEC\n' +
  '0\nSECTION\n2\nTABLES\n' +
  '0\nTABLE\n2\nLTYPE\n70\n1\n0\nLTYPE\n2\nCONTINUOUS\n70\n0\n' +
  '3\nSolid line\n72\n65\n73\n0\n40\n0.0\n0\nENDTAB\n' +
  '0\nTABLE\n2\nLAYER\n70\n1\n0\nLAYER\n2\n0\n70\n0\n62\n7\n' +
  '6\nCONTINUOUS\n370\n-1\n0\nENDTAB\n0\nENDSEC\n' +
  '0\nSECTION\n2\nBLOCKS\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n'
const footer = '0\nENDSEC\n0\nEOF\n'

// Real-world DXF records carry `100` subclass markers; the data-model parser
// uses `filer.atSubclassData(...)` to position the field cursor, and without
// the markers every coordinate below reads back as zeros/garbage.
const entityPrefix = (subclass, layer = '0') =>
  `100\nAcDbEntity\n8\n${layer}\n100\n${subclass}\n`

function line(x1, y1, x2, y2, z = 0) {
  return `0\nLINE\n${entityPrefix('AcDbLine')}10\n${fmt(x1)}\n20\n${fmt(y1)}\n30\n${fmt(z)}\n11\n${fmt(x2)}\n21\n${fmt(y2)}\n31\n${fmt(z)}\n`
}
function circle(cx, cy, r) {
  return `0\nCIRCLE\n${entityPrefix('AcDbCircle')}10\n${fmt(cx)}\n20\n${fmt(cy)}\n30\n0.0\n40\n${fmt(r)}\n`
}
function lwPolyline(x0, y0, n) {
  const parts = [`0\nLWPOLYLINE\n${entityPrefix('AcDbPolyline')}90\n${n}\n70\n0\n43\n0.5\n`]
  let x = x0
  let y = y0
  for (let i = 0; i < n; i++) {
    x += (rand() - 0.5) * 40
    y += (rand() - 0.5) * 40
    parts.push(`10\n${fmt(x)}\n20\n${fmt(y)}\n`)
  }
  return parts.join('')
}
function solid(x0, y0, w, h) {
  return (
    `0\nSOLID\n${entityPrefix('AcDbSolid')}` +
    `10\n${fmt(x0)}\n20\n${fmt(y0)}\n30\n0.0\n` +
    `11\n${fmt(x0 + w)}\n21\n${fmt(y0)}\n31\n0.0\n` +
    `12\n${fmt(x0 + w)}\n22\n${fmt(y0 + h)}\n32\n0.0\n` +
    `13\n${fmt(x0)}\n23\n${fmt(y0 + h)}\n33\n0.0\n`
  )
}
function face3d(x0, y0, w, h, z) {
  return (
    '0\n3DFACE\n100\nAcDbEntity\n8\n0\n100\nAcDbFace\n' +
    `10\n${fmt(x0)}\n20\n${fmt(y0)}\n30\n${fmt(z)}\n` +
    `11\n${fmt(x0 + w)}\n21\n${fmt(y0)}\n31\n${fmt(z)}\n` +
    `12\n${fmt(x0 + w)}\n22\n${fmt(y0 + h)}\n32\n${fmt(z)}\n` +
    `13\n${fmt(x0)}\n23\n${fmt(y0 + h)}\n33\n${fmt(z)}\n`
  )
}

async function main() {
  const outfile = process.argv[2] ?? defaultOut
  // Optional entity-count overrides for stress runs, e.g. --lines=40000.
  const counts = { lines: 1200, circles: 200, polylines: 300, solids: 300, faces: 300 }
  for (const arg of process.argv.slice(2)) {
    const m = /^--(\w+)=(\d+)$/.exec(arg)
    if (m && m[1] in counts) counts[m[1]] = Number(m[2])
  }
  const stream = createWriteStream(outfile, { encoding: 'utf8' })
  stream.write(header)

  let buffered = ''
  const flush = async (force = false) => {
    if (buffered.length >= 1 << 20 || force) {
      if (!stream.write(buffered)) {
        await new Promise(resolve => stream.once('drain', resolve))
      }
      buffered = ''
    }
  }

  const jitter = () => (rand() - 0.5) * 800
  for (let i = 0; i < counts.lines; i++) {
    const x = BASE_X + jitter()
    const y = BASE_Y + jitter()
    buffered += line(x, y, x + (rand() - 0.5) * 20, y + (rand() - 0.5) * 20)
    await flush()
  }
  for (let i = 0; i < counts.circles; i++) {
    buffered += circle(BASE_X + jitter(), BASE_Y + jitter(), 0.3 + rand() * 12)
    await flush()
  }
  for (let i = 0; i < counts.polylines; i++) {
    buffered += lwPolyline(BASE_X + jitter(), BASE_Y + jitter(), 8)
    await flush()
  }
  for (let i = 0; i < counts.solids; i++) {
    const w = 0.3 + rand() * 12
    const h = 0.3 + rand() * 12
    buffered += solid(BASE_X + jitter(), BASE_Y + jitter(), w, h)
    await flush()
  }
  // 3DFACEs: 2/3 at ground level, 1/3 elevated at the huge Z (depth-range path).
  for (let i = 0; i < counts.faces; i++) {
    const z = i % 3 === 0 ? HIGH_Z : 0
    buffered += face3d(
      BASE_X + jitter(),
      BASE_Y + jitter(),
      2 + rand() * 20,
      2 + rand() * 20,
      z
    )
    await flush()
  }

  await flush(true)
  stream.end(footer)
  await new Promise(resolve => stream.on('finish', resolve))
  console.log(`written: ${outfile}`)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
