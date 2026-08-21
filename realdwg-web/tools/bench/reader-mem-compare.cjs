// Reader-level memory comparison: old full-decode path vs windowed path.
// Retains every string value (like real entity parsing) so slices cannot be
// collected, and reports external memory + RSS in addition to heapUsed.
'use strict'
const { readFileSync } = require('node:fs')
const {
  acdbMakeAsciiDxfPairReader,
  acdbMakeWindowedAsciiDxfPairReader
} = require('@mlightcad/data-model')

function drainRetain(reader) {
  const kept = []
  for (;;) {
    const p = reader.next()
    if (p === undefined) return kept
    if (typeof p.value === 'string') kept.push(p.value)
  }
}

function peakOf(fn) {
  global.gc()
  const before = process.memoryUsage()
  let peakHeap = before.heapUsed
  let peakExt = before.external
  let peakRss = before.rss
  const timer = setInterval(() => {
    const m = process.memoryUsage()
    peakHeap = Math.max(peakHeap, m.heapUsed)
    peakExt = Math.max(peakExt, m.external)
    peakRss = Math.max(peakRss, m.rss)
  }, 10)
  const result = fn()
  clearInterval(timer)
  return {
    retained: result.length,
    heapMB: (peakHeap / 1048576).toFixed(1),
    externalMB: (peakExt / 1048576).toFixed(1),
    rssMB: (peakRss / 1048576).toFixed(1)
  }
}

const file = process.argv[2]
const bytes = new Uint8Array(readFileSync(file))
console.log('file bytes:', (bytes.length / 1048576).toFixed(1), 'MB')

const windowed = peakOf(() =>
  drainRetain(acdbMakeWindowedAsciiDxfPairReader(bytes, 'gbk'))
)
console.log('windowed gbk :', JSON.stringify(windowed))

const oldPath = peakOf(() => {
  const text = new TextDecoder('gbk').decode(bytes)
  return drainRetain(acdbMakeAsciiDxfPairReader(text))
})
console.log('full decode  :', JSON.stringify(oldPath))
