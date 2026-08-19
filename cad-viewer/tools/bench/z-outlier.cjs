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
  let minZ = Infinity, maxZ = -Infinity, minE = null, maxE = null
  let zStats = {}
  for (const e of it) {
    try {
      const g = e.geometricExtents
      if (!g || !g.min) continue
      const z = Math.abs(g.min.z ?? 0), z2 = Math.abs(g.max.z ?? 0)
      const a = Math.max(z, z2)
      const bucket = a > 1000 ? (a > 10000 ? (a > 80000 ? 'huge' : 'big') : 'mid') : 'small'
      zStats[bucket] = (zStats[bucket] ?? 0) + 1
      if ((g.min.z ?? 0) < minZ) { minZ = g.min.z; minE = e }
      if ((g.max.z ?? 0) > maxZ) { maxZ = g.max.z; maxE = e }
    } catch {}
  }
  console.log('z bucket stats:', zStats)
  for (const [tag, e, z] of [['min', minE, minZ], ['max', maxE, maxZ]]) {
    if (e) {
      console.log(tag, 'z=', z, 'type=', e.dxfTypeName, 'layer=', e.layer?.name ?? e.layer, 'extents=', JSON.stringify(e.geometricExtents)?.slice(0,160))
    }
  }
}
main().catch(e => { console.error(e); process.exit(1) })
