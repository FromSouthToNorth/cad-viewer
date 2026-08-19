#!/usr/bin/env node
/**
 * Generate synthetic DXF files for loading benchmarks.
 *
 * The output is ASCII DXF (AC1015) with a minimal HEADER/TABLES/BLOCKS and a
 * single "0" layer, modeled on the minimal-line.dxf e2e fixture that the
 * parser is known to accept. Entities are streamed to disk so generation
 * stays memory-light even for 1M+ entities.
 *
 * Usage:
 *   node tools/bench/generate-large-dxf.mjs <type> [count] [outfile]
 *
 * Types:
 *   lines        LINE entities (default count 100000)
 *   lwpolylines  LWPOLYLINE entities, 8 vertices each (count = polylines)
 *   circles      CIRCLE entities
 *   arcs         ARC entities
 *   splines      fit-point SPLINE entities (SPLINE_FIT_POINTS env, default 100)
 *   mixed        mix of line/circle/arc/text/lwpolyline
 *   bigcoords    LINE entities with |coord| >= 1e6 (mm / survey coordinates)
 */
import { createWriteStream } from 'node:fs'
import { mkdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const toolsDir = dirname(fileURLToPath(import.meta.url))
const defaultOutDir = join(toolsDir, 'fixtures')

const DEFAULT_COUNTS = {
  lines: 100000,
  lwpolylines: 20000,
  circles: 50000,
  arcs: 50000,
  splines: 500,
  mixed: 100000,
  bigcoords: 100000
}

// Deterministic LCG so benchmark runs are reproducible.
function makeRandom(seed) {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0xffffffff
  }
}

const rand = makeRandom(0xc0ffee)

function fmt(n) {
  return n.toFixed(4)
}

function header(out) {
  out.push('0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1015\n0\nENDSEC\n')
  out.push(
    '0\nSECTION\n2\nTABLES\n' +
      '0\nTABLE\n2\nLTYPE\n70\n1\n0\nLTYPE\n2\nCONTINUOUS\n70\n0\n' +
      '3\nSolid line\n72\n65\n73\n0\n40\n0.0\n0\nENDTAB\n' +
      '0\nTABLE\n2\nLAYER\n70\n1\n0\nLAYER\n2\n0\n70\n0\n62\n7\n' +
      '6\nCONTINUOUS\n370\n-1\n0\nENDTAB\n0\nENDSEC\n'
  )
  out.push('0\nSECTION\n2\nBLOCKS\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n')
}

const footer = '0\nENDSEC\n0\nEOF\n'

function appendLine(x1, y1, x2, y2) {
  return (
    `0\nLINE\n8\n0\n10\n${fmt(x1)}\n20\n${fmt(y1)}\n30\n0.0\n` +
    `11\n${fmt(x2)}\n21\n${fmt(y2)}\n31\n0.0\n`
  )
}

function appendCircle(cx, cy, r) {
  return `0\nCIRCLE\n8\n0\n10\n${fmt(cx)}\n20\n${fmt(cy)}\n30\n0.0\n40\n${fmt(r)}\n`
}

function appendArc(cx, cy, r, a1, a2) {
  return (
    `0\nARC\n8\n0\n10\n${fmt(cx)}\n20\n${fmt(cy)}\n30\n0.0\n40\n${fmt(r)}\n` +
    `100\n${fmt(a1)}\n50\n${fmt(a2)}\n`
  )
}

function appendLwPolyline(x0, y0, vertices) {
  const lines = [`0\nLWPOLYLINE\n8\n0\n90\n${vertices}\n70\n0\n`]
  let x = x0
  let y = y0
  for (let i = 0; i < vertices; i++) {
    x += rand() * 20 - 10
    y += rand() * 20 - 10
    lines.push(`10\n${fmt(x)}\n20\n${fmt(y)}\n`)
    if (i % 3 === 0) lines.push(`42\n${fmt((rand() - 0.5) * 0.5)}\n`)
  }
  return lines.join('')
}

function appendSpline(x0, y0, fitPoints) {
  const lines = [
    `0\nSPLINE\n8\n0\n70\n8\n71\n3\n72\n0\n73\n0\n74\n${fitPoints}\n`
  ]
  let x = x0
  let y = y0
  for (let i = 0; i < fitPoints; i++) {
    x += rand() * 10 - 5
    y += rand() * 10 - 5
    lines.push(`11\n${fmt(x)}\n21\n${fmt(y)}\n31\n0.0\n`)
  }
  return lines.join('')
}

function appendText(x, y, h) {
  return `0\nTEXT\n8\n0\n10\n${fmt(x)}\n20\n${fmt(y)}\n30\n0.0\n40\n${fmt(h)}\n1\nBENCH\n`
}

async function streamEntities(file, type, count) {
  const stream = createWriteStream(file, { encoding: 'utf8' })
  const out = []
  header(out)
  stream.write(out.join(''))

  let buffered = ''
  const flush = async (force = false) => {
    if (buffered.length >= 1 << 20 || force) {
      if (!stream.write(buffered)) {
        await new Promise((resolve) => stream.once('drain', resolve))
      }
      buffered = ''
    }
  }

  for (let i = 0; i < count; i++) {
    const x = rand() * 2000 - 1000
    const y = rand() * 2000 - 1000
    switch (type) {
      case 'lines':
        buffered += appendLine(x, y, x + rand() * 10, y + rand() * 10)
        break
      case 'bigcoords': {
        const s = 1e6
        buffered += appendLine(x * s, y * s, (x + rand() * 10) * s, (y + rand() * 10) * s)
        break
      }
      case 'circles':
        buffered += appendCircle(x, y, rand() * 10)
        break
      case 'arcs':
        buffered += appendArc(x, y, rand() * 10, rand() * 360, rand() * 360)
        break
      case 'lwpolylines':
        buffered += appendLwPolyline(x, y, 8)
        break
      case 'splines':
        buffered += appendSpline(x, y, Number(process.env.SPLINE_FIT_POINTS ?? 100))
        break
      case 'mixed': {
        const r = rand()
        if (r < 0.4) buffered += appendLine(x, y, x + 10, y + 10)
        else if (r < 0.6) buffered += appendCircle(x, y, rand() * 10)
        else if (r < 0.75) buffered += appendArc(x, y, rand() * 10, rand() * 360, rand() * 360)
        else if (r < 0.9) buffered += appendText(x, y, 2.5)
        else buffered += appendLwPolyline(x, y, 8)
        break
      }
      default:
        throw new Error(`Unknown type: ${type}`)
    }
    await flush()
  }

  await flush(true)
  stream.end(footer)
  await new Promise((resolve) => stream.on('finish', resolve))
}

async function main() {
  const type = process.argv[2] ?? 'lines'
  const count = Number(process.argv[3] ?? DEFAULT_COUNTS[type])
  if (!DEFAULT_COUNTS[type]) {
    throw new Error(`Unknown type "${type}". Choose one of: ${Object.keys(DEFAULT_COUNTS).join(', ')}`)
  }
  const outfile = process.argv[4] ?? join(defaultOutDir, `${type}-${count}.dxf`)
  await mkdir(dirname(outfile), { recursive: true })
  console.log(`Generating ${type}-${count} -> ${outfile} ...`)
  const start = Date.now()
  await streamEntities(outfile, type, count)
  const elapsed = Date.now() - start
  const { size } = await stat(outfile)
  console.log(`Done in ${elapsed} ms, ${(size / 1024 / 1024).toFixed(1)} MB`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
