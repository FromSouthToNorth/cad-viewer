/**
 * Parses a DXF and reports model-space entity type counts, per-type extent
 * spans, and coordinate extents. Used to target render-path analysis.
 *
 * Usage: node tools/bench/count-entities.cjs <file.dxf>
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
  if (!file) {
    console.error('usage: node count-entities.cjs <file.dxf>')
    process.exit(1)
  }

  const t0 = Date.now()
  const database = new AcDbDatabase()
  acdbHostApplicationServices().workingDatabase = database
  const buffer = await readFile(file)
  AcDbDatabaseConverterManager.instance.register(
    AcDbFileType.DXF,
    new AcDbNativeDxfConverter({ convertByEntityType: false, useWorker: false })
  )
  await database.read(
    buffer,
    { minimumChunkSize: 1000, readOnly: true },
    AcDbFileType.DXF
  )

  const modelSpace = database.tables.blockTable.modelSpace
  const it = modelSpace.newIterator()
  const byType = new Map()
  let minX = Infinity, maxX = -Infinity
  let minY = Infinity, maxY = -Infinity
  let minZ = Infinity, maxZ = -Infinity
  let total = 0

  for (const entity of it) {
    total++
    const type = entity.dxfTypeName ?? entity.constructor.name
    const entry = byType.get(type) ?? { count: 0, span: 0, maxSpanEnt: 0 }
    entry.count++
    try {
      const b = entity.geometricExtents
      if (b && b.min && b.max) {
        const mn = b.min
        const mx = b.max
        const span = Math.max(mx.x - mn.x, mx.y - mn.y, (mx.z ?? 0) - (mn.z ?? 0))
        entry.span += span
        entry.maxSpanEnt = Math.max(entry.maxSpanEnt, span)
        minX = Math.min(minX, mn.x)
        maxX = Math.max(maxX, mx.x)
        minY = Math.min(minY, mn.y)
        maxY = Math.max(maxY, mx.y)
        minZ = Math.min(minZ, mn.z ?? 0)
        maxZ = Math.max(maxZ, mx.z ?? 0)
      }
    } catch {
      /* entity without extents */
    }
    byType.set(type, entry)
  }

  const rows = [...byType.entries()]
    .map(([type, e]) => ({ type, ...e, avgSpan: +(e.span / e.count).toFixed(0) }))
    .sort((a, b) => b.count - a.count)

  console.log(`parse ${((Date.now() - t0) / 1000).toFixed(1)}s, ${total} entities`)
  console.log(`extent x=[${minX.toFixed(1)}, ${maxX.toFixed(1)}] y=[${minY.toFixed(1)}, ${maxY.toFixed(1)}] z=[${minZ.toFixed(1)}, ${maxZ.toFixed(1)}]`)
  console.log('type | count | avgSpan | maxSpan')
  for (const r of rows) {
    console.log(`${r.type} | ${r.count} | ${r.avgSpan} | ${r.maxSpanEnt.toFixed(0)}`)
  }
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
