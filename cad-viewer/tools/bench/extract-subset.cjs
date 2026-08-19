/**
 * Loads a DXF and writes a smaller DXF keeping a representative entity mix:
 * all TEXT/HATCH/CIRCLE/POINT/SPLINE plus the first N LINE and M ARC entities.
 *
 * Usage: node tools/bench/extract-subset.cjs <in.dxf> <out.dxf> [maxLine] [maxArc]
 */
'use strict'

const { readFile, writeFile } = require('node:fs/promises')
const {
  AcDbDatabase,
  AcDbDatabaseConverterManager,
  AcDbFileType,
  acdbHostApplicationServices,
  AcDbNativeDxfConverter
} = require('@mlightcad/data-model')

async function main() {
  const [inFile, outFile, maxLineStr, maxArcStr] = process.argv.slice(2)
  if (!inFile || !outFile) {
    console.error('usage: node extract-subset.cjs <in.dxf> <out.dxf> [maxLine] [maxArc]')
    process.exit(1)
  }
  const maxLine = Number(maxLineStr ?? 30000)
  const maxArc = Number(maxArcStr ?? 3000)

  const t0 = Date.now()
  const database = new AcDbDatabase()
  acdbHostApplicationServices().workingDatabase = database
  const buffer = await readFile(inFile)
  AcDbDatabaseConverterManager.instance.register(
    AcDbFileType.DXF,
    new AcDbNativeDxfConverter({ convertByEntityType: false, useWorker: false })
  )
  await database.read(buffer, { minimumChunkSize: 1000, readOnly: true }, AcDbFileType.DXF)
  console.log(`parsed in ${((Date.now() - t0) / 1000).toFixed(1)}s`)

  const ms = database.tables.blockTable.modelSpace
  const it = ms.newIterator()
  let lineKept = 0
  let arcKept = 0
  const keep = []
  const drop = []
  for (const e of it) {
    const t = e.dxfTypeName
    if (t === 'LINE') {
      if (lineKept < maxLine) { lineKept++; keep.push(e.objectId) } else { drop.push(e.objectId) }
    } else if (t === 'ARC') {
      if (arcKept < maxArc) { arcKept++; keep.push(e.objectId) } else { drop.push(e.objectId) }
    } else {
      keep.push(e.objectId)
    }
  }
  console.log(`keep=${keep.length} drop=${drop.length} (line ${lineKept}, arc ${arcKept})`)

  const t1 = Date.now()
  ms.removeEntity(drop)
  console.log(`removed in ${((Date.now() - t1) / 1000).toFixed(1)}s`)

  const t2 = Date.now()
  const dxf = database.dxfOut(undefined, 16, undefined, { format: 'ascii' })
  await writeFile(outFile, dxf)
  console.log(`dxfOut in ${((Date.now() - t2) / 1000).toFixed(1)}s -> ${outFile} (${(dxf.length / 1e6).toFixed(1)}MB)`)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
