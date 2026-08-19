'use strict'
const { readFile } = require('node:fs/promises')
const { AcDbDatabase, AcDbDatabaseConverterManager, AcDbFileType, acdbHostApplicationServices, AcDbNativeDxfConverter } = require('@mlightcad/data-model')
async function main() {
  const database = new AcDbDatabase()
  acdbHostApplicationServices().workingDatabase = database
  const buffer = await readFile(process.argv[2])
  AcDbDatabaseConverterManager.instance.register(AcDbFileType.DXF, new AcDbNativeDxfConverter({ convertByEntityType: false, useWorker: false }))
  await database.read(buffer, { minimumChunkSize: 1000, readOnly: true }, AcDbFileType.DXF)
  const ms = database.tables.blockTable.modelSpace
  const it = ms.newIterator()
  let n = 0
  for (const e of it) {
    n++
    if (n <= 5) {
      console.log('--- entity', n)
      console.log('  own props:', Object.keys(e).join(','))
      console.log('  proto props:', Object.getOwnPropertyNames(Object.getPrototypeOf(e)).slice(0, 40).join(','))
      try { const g = e.geometricExtents; console.log('  extents:', JSON.stringify(g)?.slice(0, 200)) } catch (err) { console.log('  extents err', String(err).slice(0, 100)) }
    }
    if (n === 5) break
  }
  console.log('done', n)
}
main().catch(e => { console.error(e); process.exit(1) })
