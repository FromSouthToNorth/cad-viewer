#!/usr/bin/env node
/**
 * Debug helper: parse a DXF while logging open progress percentages and the
 * type of each appended entity, to pinpoint which entity stalls the parse.
 *
 * Usage:
 *   node tools/bench/debug-parse-stall.cjs <file.dxf> [stallMs]
 *
 * Exits non-zero when the last progress callback was longer than stallMs ago.
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

async function main() {
  const file = process.argv[2]
  const stallMs = Number(process.argv[3] ?? 30000)
  const buffer = await readFile(file)
  console.log(`file: ${file}, bytes: ${buffer.byteLength}`)

  AcDbDatabaseConverterManager.instance.register(
    AcDbFileType.DXF,
    new AcDbNativeDxfConverter({ convertByEntityType: false, useWorker: false })
  )

  const db = new AcDbDatabase()
  acdbHostApplicationServices().workingDatabase = db

  const start = Date.now()
  let lastProgressAt = start
  let lastProgress = null
  let entityCount = 0
  let lastEntity = null
  let lastEntityAt = start

  db.events.openProgress.addEventListener((args) => {
    lastProgressAt = Date.now()
    const label = `${args.stage}.${args.subStage ?? ''}.${args.subStageStatus} ${args.percentage}%`
    if (label !== lastProgress) {
      lastProgress = label
      console.log(`  [${((Date.now() - start) / 1000).toFixed(1)}s] progress: ${label}`)
    }
  })

  db.events.entityAppended.addEventListener((args) => {
    entityCount++
    lastEntityAt = Date.now()
    if (entityCount % 5000 === 0 || lastEntity !== args.entity?.type) {
      lastEntity = args.entity?.type
      console.log(
        `  [${((Date.now() - start) / 1000).toFixed(1)}s] entity #${entityCount}: ${lastEntity}`
      )
    }
  })

  // Watchdog: report when progress stops advancing.
  const watchdog = setInterval(() => {
    const idle = Date.now() - lastProgressAt
    if (idle > stallMs) {
      console.log(
        `\nSTALL: no progress for ${(idle / 1000).toFixed(1)}s. ` +
          `last progress: ${lastProgress}, last entity appended: #${entityCount} ${lastEntity}`
      )
      process.exit(1)
    }
  }, 5000)

  await db.read(buffer, { minimumChunkSize: 1000, readOnly: true }, AcDbFileType.DXF)
  clearInterval(watchdog)
  const entities = db.tables.blockTable.modelSpace.newIterator().count
  console.log(`done in ${((Date.now() - start) / 1000).toFixed(1)}s, entities: ${entities}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
