#!/usr/bin/env node
/**
 * Benchmark DXF parsing with @mlightcad/data-model (main-thread native
 * converter, same path the example app uses).
 *
 * Uses the CJS dist bundle so it can run in plain Node without a bundler.
 *
 * Reports wall-clock parse time, peak heap/RSS during parse, and the entity
 * count of the resulting model space.
 *
 * Usage:
 *   node tools/bench/bench-parse.cjs <file.dxf> [--repeat n] [--gc]
 *
 * --gc requires running with --expose-gc (enables pre/post collections for
 * more stable heap deltas).
 */
'use strict'

const { readFile } = require('node:fs/promises')
const {
  AcDbDatabase,
  AcDbDatabaseConverterManager,
  AcDbFileType,
  acdbHostApplicationServices,
  AcDbNativeDxfConverter
} = require('@mlightcad/data-model')

function parseArgs(argv) {
  let file = null
  let repeat = 1
  let gc = false
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--repeat') repeat = Number(argv[++i])
    else if (arg === '--gc') gc = true
    else file = arg
  }
  if (!file) {
    console.error('Usage: node bench-parse.cjs <file.dxf> [--repeat n] [--gc]')
    process.exit(1)
  }
  return { file, repeat, gc }
}

function startMemorySampling() {
  let peakHeap = 0
  let peakRss = 0
  const timer = setInterval(() => {
    const usage = process.memoryUsage()
    if (usage.heapUsed > peakHeap) peakHeap = usage.heapUsed
    if (usage.rss > peakRss) peakRss = usage.rss
  }, 10)
  return {
    stop() {
      clearInterval(timer)
      return { peakHeap, peakRss }
    }
  }
}

async function parseOnce(buffer) {
  const database = new AcDbDatabase()
  acdbHostApplicationServices().workingDatabase = database
  const start = performance.now()
  await database.read(
    buffer,
    { minimumChunkSize: 1000, readOnly: true },
    AcDbFileType.DXF
  )
  const durationMs = performance.now() - start
  const entityCount = database.tables.blockTable.modelSpace.newIterator().count
  return { durationMs, entityCount }
}

async function main() {
  const { file, repeat, gc } = parseArgs(process.argv)
  const buffer = await readFile(file)
  const bytes = buffer.byteLength

  AcDbDatabaseConverterManager.instance.register(
    AcDbFileType.DXF,
    new AcDbNativeDxfConverter({ convertByEntityType: false, useWorker: false })
  )

  const durations = []
  let entityCount = 0
  let peakHeap = 0
  let peakRss = 0

  for (let i = 0; i < repeat; i++) {
    if (gc) global.gc()
    const sampler = startMemorySampling()
    const result = await parseOnce(buffer)
    const peaks = sampler.stop()
    durations.push(result.durationMs)
    entityCount = result.entityCount
    peakHeap = Math.max(peakHeap, peaks.peakHeap)
    peakRss = Math.max(peakRss, peaks.peakRss)
  }

  durations.sort((a, b) => a - b)
  const best = durations[0]
  const avg = durations.reduce((sum, d) => sum + d, 0) / durations.length

  console.log(
    JSON.stringify(
      {
        file,
        bytes,
        entities: entityCount,
        repeat,
        bestMs: Number(best.toFixed(2)),
        avgMs: Number(avg.toFixed(2)),
        peakHeapMB: Number((peakHeap / 1024 / 1024).toFixed(1)),
        peakRssMB: Number((peakRss / 1024 / 1024).toFixed(1)),
        usPerEntity: Number(((best * 1000) / entityCount).toFixed(2))
      },
      null,
      2
    )
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
