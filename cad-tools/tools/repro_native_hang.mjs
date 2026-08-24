// 复现原生 DXF 转换器挂起: node repro_native_hang.mjs <file.dxf>
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const lib = require('F:/gis/bw-cad-view/realdwg-web/packages/data-model/dist/data-model.cjs')
const { AcDbNativeDxfConverter, AcDbDatabase } = lib
console.log('exports ok:', !!AcDbNativeDxfConverter, !!AcDbDatabase)

const file = process.argv[2]
const buf = readFileSync(resolve(file))
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)

const db = new AcDbDatabase()
lib.acdbHostApplicationServices().workingDatabase = db
const conv = new AcDbNativeDxfConverter({ useWorker: false })

let last = ''
const timer = setInterval(() => {
  console.log('[alive] last stage:', last)
}, 3000)

const t0 = Date.now()
try {
  await conv.read(ab, db, {
    progress: async (pct, stage, status) => {
      const s = `${stage}/${status} ${pct}%`
      if (s !== last) { last = s; console.log(`[${((Date.now()-t0)/1000).toFixed(1)}s]`, s) }
    }
  })
  console.log(`DONE in ${((Date.now()-t0)/1000).toFixed(1)}s`)
} catch (e) {
  console.log('ERROR:', e?.message ?? e)
}
clearInterval(timer)
process.exit(0)
