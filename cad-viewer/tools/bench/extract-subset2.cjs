'use strict'
const { readFile, writeFile } = require('node:fs/promises')
const { AcDbDatabase, AcDbDatabaseConverterManager, AcDbFileType, acdbHostApplicationServices, AcDbNativeDxfConverter } = require('@mlightcad/data-model')
async function main() {
  const [inFile, outFile] = process.argv.slice(2)
  const limits = { LINE: 4000, ARC: 800, TEXT: 600, HATCH: 300, CIRCLE: 100, POINT: 5, SPLINE: 3 }
  const database = new AcDbDatabase()
  acdbHostApplicationServices().workingDatabase = database
  const buffer = await readFile(inFile)
  AcDbDatabaseConverterManager.instance.register(AcDbFileType.DXF, new AcDbNativeDxfConverter({ convertByEntityType: false, useWorker: false }))
  await database.read(buffer, { minimumChunkSize: 1000, readOnly: true }, AcDbFileType.DXF)
  const ms = database.tables.blockTable.modelSpace
  const it = ms.newIterator()
  const kept = {}
  const keep = [], drop = []
  for (const e of it) {
    const t = e.dxfTypeName
    const limit = limits[t] ?? Infinity
    const n = kept[t] ?? 0
    if (n < limit) { kept[t] = n + 1; keep.push(e.objectId) } else { drop.push(e.objectId) }
  }
  console.log('keep:', kept, 'total', keep.length, 'drop', drop.length)
  ms.removeEntity(drop)
  const dxf = database.dxfOut(undefined, 16, undefined, { format: 'ascii' })
  await writeFile(outFile, dxf)
  console.log('wrote', outFile, (dxf.length / 1e6).toFixed(1) + 'MB')
}
main().catch(e => { console.error(e); process.exit(1) })
