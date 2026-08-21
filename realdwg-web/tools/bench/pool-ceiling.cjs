#!/usr/bin/env node
/**
 * Ceiling measurement for the M2-3 pair-pooling experiment.
 *
 * Implements a faithful copy of the windowed pair-reader loop twice:
 *   1. allocating a fresh {code, type, value} per pair (current behaviour)
 *   2. recycling pair objects from a 64-slot ring pool (best-case pooling,
 *      ignoring the filer pushback/retention hazards that a real
 *      implementation must solve)
 * and compares throughput on a real fixture. The delta is the MAXIMUM a
 * pooling implementation could ever win at reader level; if it is small,
 * pooling is not worth the filer protocol changes.
 */
'use strict'

const { readFileSync } = require('node:fs')

const file = process.argv[2]
if (!file) {
  console.error('Usage: node pool-ceiling.cjs <file.dxf>')
  process.exit(1)
}
const bytes = new Uint8Array(readFileSync(file))

const isWs = (c) =>
  c === 0x20 || c === 0xa0 || c === 0x1680 || c === 0x2028 || c === 0x2029 ||
  c === 0x202f || c === 0x205f || c === 0x3000 || c === 0xfeff ||
  (c >= 0x09 && c <= 0x0d) || (c >= 0x2000 && c <= 0x200a)

const valueType = (code) => {
  if (code === 999) return 'comment'
  if (code === 5) return 'handle'
  if (code <= 9) return 'string'
  if (code === 100 || code === 102) return 'string'
  if (code === 105) return 'handle'
  if (code >= 101 && code <= 109) return 'string'
  if (code <= 59) return 'double'
  if (code <= 79) return 'int'
  if (code <= 89) return 'string'
  if (code <= 99) return 'int'
  if (code <= 149) return 'double'
  if (code <= 159) return 'string'
  if (code <= 169) return 'long'
  if (code <= 179) return 'int'
  if (code <= 209) return 'string'
  if (code <= 239) return 'double'
  if (code <= 269) return 'long'
  if (code <= 289) return 'int'
  if (code <= 299) return 'bool'
  if (code <= 309) return 'string'
  if (code <= 319) return 'binary'
  if (code <= 369) return 'handle'
  if (code <= 389) return 'int'
  if (code <= 399) return 'handle'
  if (code <= 409) return 'int'
  if (code <= 419) return 'string'
  if (code <= 429) return 'int'
  if (code <= 439) return 'string'
  if (code <= 449) return 'int'
  if (code <= 459) return 'int'
  if (code <= 469) return 'double'
  if (code <= 479) return 'string'
  if (code === 480 || code === 481) return 'handle'
  if (code === 1004) return 'binary'
  if (code === 1005) return 'handle'
  if (code >= 1000 && code <= 1009) return 'string'
  if (code >= 1010 && code <= 1059) return 'double'
  if (code >= 1060 && code <= 1070) return 'int'
  if (code === 1071) return 'int'
  return 'string'
}

function readDxfCode(text, start, end) {
  let i = start
  while (i < end && isWs(text.charCodeAt(i))) i++
  if (i >= end) return NaN
  let sign = 1
  const c0 = text.charCodeAt(i)
  if (c0 === 0x2d) { sign = -1; i++ } else if (c0 === 0x2b) i++
  let value = 0
  let digits = 0
  while (i < end) {
    const c = text.charCodeAt(i)
    if (c >= 0x30 && c <= 0x39) { value = value * 10 + (c - 0x30); digits++; i++ } else break
  }
  if (digits === 0) return NaN
  while (i < end) {
    if (!isWs(text.charCodeAt(i))) return NaN
    i++
  }
  return sign * value
}

function parseDouble(text, start, end) {
  // Minimal double parse — this prototype only needs realistic cost, exactness
  // is irrelevant here. Uses Number() on the slice like the pre-M2-1 parser.
  return Number(text.slice(start, end))
}

const WINDOW = 64 * 1024
let count = 0

function runAlloc() {
  const decoder = new TextDecoder('utf-8')
  let windowStart = 0
  let windowEnd = 0
  let text = ''
  let textPos = 0

  const advance = () => {
    if (windowEnd >= bytes.length) return false
    windowStart = windowEnd
    let end = Math.min(windowStart + WINDOW, bytes.length)
    while (end < bytes.length && bytes[end] !== 10 && bytes[end] !== 13) end++
    if (end < bytes.length && bytes[end] === 13) end++
    if (end < bytes.length && bytes[end] === 10) end++
    windowEnd = end
    text = decoder.decode(bytes.subarray(windowStart, windowEnd))
    textPos = 0
    return true
  }

  const lineSpan = () => {
    while (textPos >= text.length) {
      if (!advance()) return undefined
    }
    const start = textPos
    let contentEnd = textPos
    while (contentEnd < text.length) {
      const c = text.charCodeAt(contentEnd)
      if (c === 10 || c === 13) break
      contentEnd++
    }
    let end = contentEnd
    if (end < text.length && text.charCodeAt(end) === 13) end++
    if (end < text.length && text.charCodeAt(end) === 10) end++
    textPos = end
    return { start, end: contentEnd }
  }

  const raw = () => {
    for (;;) {
      const codeSpan = lineSpan()
      if (codeSpan === undefined) return undefined
      const code = readDxfCode(text, codeSpan.start, codeSpan.end)
      if (Number.isNaN(code)) continue
      if (code === 999) {
        if (lineSpan() === undefined) return undefined
        continue
      }
      const v = lineSpan()
      if (v === undefined) return undefined
      const type = valueType(code)
      let value
      if (type === 'string' || type === 'handle') value = text.slice(v.start, v.end)
      else if (type === 'double') value = parseDouble(text, v.start, v.end)
      else if (type === 'int') value = 0
      else if (type === 'long') value = 0
      else if (type === 'bool') value = false
      else if (type === 'binary') value = new Uint8Array(0)
      else continue
      return { code, type, value }
    }
  }

  const t0 = performance.now()
  count = 0
  while (raw() !== undefined) count++
  return performance.now() - t0
}

function runPooled() {
  const decoder = new TextDecoder('utf-8')
  const POOL = 64
  const pool = []
  for (let i = 0; i < POOL; i++) pool.push({ code: 0, type: 'double', value: 0 })
  let pi = 0
  let windowStart = 0
  let windowEnd = 0
  let text = ''
  let textPos = 0

  const advance = () => {
    if (windowEnd >= bytes.length) return false
    windowStart = windowEnd
    let end = Math.min(windowStart + WINDOW, bytes.length)
    while (end < bytes.length && bytes[end] !== 10 && bytes[end] !== 13) end++
    if (end < bytes.length && bytes[end] === 13) end++
    if (end < bytes.length && bytes[end] === 10) end++
    windowEnd = end
    text = decoder.decode(bytes.subarray(windowStart, windowEnd))
    textPos = 0
    return true
  }

  const lineSpan = () => {
    while (textPos >= text.length) {
      if (!advance()) return undefined
    }
    const start = textPos
    let contentEnd = textPos
    while (contentEnd < text.length) {
      const c = text.charCodeAt(contentEnd)
      if (c === 10 || c === 13) break
      contentEnd++
    }
    let end = contentEnd
    if (end < text.length && text.charCodeAt(end) === 13) end++
    if (end < text.length && text.charCodeAt(end) === 10) end++
    textPos = end
    return { start, end: contentEnd }
  }

  const raw = () => {
    for (;;) {
      const codeSpan = lineSpan()
      if (codeSpan === undefined) return undefined
      const code = readDxfCode(text, codeSpan.start, codeSpan.end)
      if (Number.isNaN(code)) continue
      if (code === 999) {
        if (lineSpan() === undefined) return undefined
        continue
      }
      const v = lineSpan()
      if (v === undefined) return undefined
      const type = valueType(code)
      const p = pool[pi]
      pi = (pi + 1) % POOL
      p.code = code
      p.type = type
      if (type === 'string' || type === 'handle') p.value = text.slice(v.start, v.end)
      else if (type === 'double') p.value = parseDouble(text, v.start, v.end)
      else if (type === 'int') p.value = 0
      else if (type === 'long') p.value = 0
      else if (type === 'bool') p.value = false
      else if (type === 'binary') p.value = new Uint8Array(0)
      else continue
      return p
    }
  }

  const t0 = performance.now()
  count = 0
  while (raw() !== undefined) count++
  return performance.now() - t0
}

// warm-up + 3 samples each
for (const fn of [runAlloc, runPooled]) fn()
const samples = { alloc: [], pooled: [] }
for (let i = 0; i < 3; i++) {
  samples.alloc.push(runAlloc())
  samples.pooled.push(runPooled())
}
const best = (a) => Math.min(...a)
console.log(
  JSON.stringify({
    file,
    pairs: count,
    allocBestMs: Number(best(samples.alloc).toFixed(1)),
    pooledBestMs: Number(best(samples.pooled).toFixed(1)),
    ceilingGainPct: Number(
      (((best(samples.alloc) - best(samples.pooled)) / best(samples.alloc)) * 100).toFixed(2)
    )
  })
)
