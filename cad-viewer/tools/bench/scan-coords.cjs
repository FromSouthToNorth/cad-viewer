/**
 * Streams a DXF file and reports world-coordinate statistics for the
 * ENTITIES and BLOCKS sections: per-section extents, magnitudes histogram,
 * NaN/Infinity counts, and per-layer extents (top offenders first).
 *
 * Usage: node scan-coords.cjs <file.dxf>
 */
const fs = require('fs')
const readline = require('readline')

const file = process.argv[2]
if (!file) {
  console.error('usage: node scan-coords.cjs <file.dxf>')
  process.exit(1)
}

// Coordinate group codes: 10-13 = X, 20-23 = Y, 30-33 = Z
const COORD_CODES = new Set([10, 11, 12, 13, 20, 21, 22, 23, 30, 31, 32, 33])

function newStats() {
  return {
    coordCount: 0,
    nanCount: 0,
    entityCount: 0,
    minX: Infinity,
    maxX: -Infinity,
    minY: Infinity,
    maxY: -Infinity,
    minZ: Infinity,
    maxZ: -Infinity,
    maxAbs: 0,
    buckets: [0, 0, 0, 0, 0, 0], // <1e2, <1e4, <1e5, <1e6, <1e8, >=1e8
    entityBucket: [0, 0, 0, 0, 0, 0] // entities by their max |coord|
  }
}

function bucketIndex(abs) {
  if (abs < 1e2) return 0
  if (abs < 1e4) return 1
  if (abs < 1e5) return 2
  if (abs < 1e6) return 3
  if (abs < 1e8) return 4
  return 5
}

function newLayer() {
  return {
    coords: 0,
    entities: 0,
    minX: Infinity,
    maxX: -Infinity,
    minY: Infinity,
    maxY: -Infinity,
    minZ: Infinity,
    maxZ: -Infinity,
    maxAbs: 0
  }
}

async function main() {
  const rl = readline.createInterface({
    input: fs.createReadStream(file, { encoding: 'utf8' }),
    crlfDelay: Infinity
  })

  let code = null
  let section = null // 'HEADER' | 'BLOCKS' | 'ENTITIES' | ...
  let sectionPending = false
  let currentLayer = '0'
  let entityMaxAbs = 0
  let entityHasCoord = false
  let headerVar = null

  const entities = newStats()
  const blocks = newStats()
  const layers = new Map()
  const extHeader = { x: null, y: null, z: null }

  const active = () => (section === 'ENTITIES' ? entities : section === 'BLOCKS' ? blocks : null)
  const layerStats = name => {
    let s = layers.get(name)
    if (!s) {
      s = newLayer()
      layers.set(name, s)
    }
    return s
  }
  const noteCoord = (st, ls, n, comp) => {
    const abs = Math.abs(n)
    st.coordCount++
    st.maxAbs = Math.max(st.maxAbs, abs)
    st.buckets[bucketIndex(abs)]++
    if (comp === 'x') {
      st.minX = Math.min(st.minX, n)
      st.maxX = Math.max(st.maxX, n)
      ls.minX = Math.min(ls.minX, n)
      ls.maxX = Math.max(ls.maxX, n)
    } else if (comp === 'y') {
      st.minY = Math.min(st.minY, n)
      st.maxY = Math.max(st.maxY, n)
      ls.minY = Math.min(ls.minY, n)
      ls.maxY = Math.max(ls.maxY, n)
    } else {
      st.minZ = Math.min(st.minZ, n)
      st.maxZ = Math.max(st.maxZ, n)
      ls.minZ = Math.min(ls.minZ, n)
      ls.maxZ = Math.max(ls.maxZ, n)
    }
    ls.coords++
    ls.maxAbs = Math.max(ls.maxAbs, abs)
    entityMaxAbs = Math.max(entityMaxAbs, abs)
    entityHasCoord = true
  }

  let lineNo = 0
  for await (const line of rl) {
    lineNo++
    const t = line.trim()
    if (t === '') {
      code = null
      continue
    }

    if (code === null) {
      const c = Number(t)
      code = Number.isInteger(c) ? c : -1
      continue
    }

    const value = t

    if (code === 0) {
      // New record begins.
      if (entityHasCoord) {
        const st = active()
        if (st) {
          st.entityCount++
          st.entityBucket[bucketIndex(entityMaxAbs)]++
          layerStats(currentLayer).entities++
        }
        entityHasCoord = false
        entityMaxAbs = 0
      }
      if (value === 'SECTION') {
        sectionPending = true
      } else if (value === 'ENDSEC') {
        section = null
      } else if (section !== null) {
        // Entity type marker within a section.
      }
      code = null
      continue
    }

    if (sectionPending) {
      if (code === 2) {
        section = value
      }
      sectionPending = false
      code = null
      continue
    }

    if (section === 'ENTITIES' || section === 'BLOCKS') {
      if (code === 8) {
        currentLayer = value
      } else if (COORD_CODES.has(code)) {
        const n = parseFloat(value)
        const st = active()
        if (st == null) {
          code = null
          continue
        }
        if (Number.isNaN(n)) {
          st.nanCount++
          code = null
          continue
        }
        const comp = code % 10 === 0 ? 'x' : code % 10 === 1 ? 'y' : 'z'
        noteCoord(st, layerStats(currentLayer), n, comp)
      }
    } else if (section === 'HEADER') {
      if (code === 9) {
        headerVar = value
      } else if (
        headerVar === '$EXTMIN' &&
        (code === 10 || code === 20 || code === 30)
      ) {
        const n = parseFloat(value)
        if (!Number.isNaN(n)) {
          if (code === 10) extHeader.x = n
          else if (code === 20) extHeader.y = n
          else extHeader.z = n
        }
      }
    }

    code = null
  }

  // Flush trailing entity.
  if (entityHasCoord) {
    const st = active()
    if (st) {
      st.entityCount++
      st.entityBucket[bucketIndex(entityMaxAbs)]++
      layerStats(currentLayer).entities++
    }
  }

  const fmt = (st, label) => {
    console.log(`\n=== ${label} ===`)
    console.log(`  records with coordinates: ${st.entityCount}`)
    console.log(`  coordinate values:        ${st.coordCount} (NaN: ${st.nanCount})`)
    console.log(
      `  X: [${st.minX === Infinity ? '-' : st.minX.toFixed(3)}, ${
        st.maxX === -Infinity ? '-' : st.maxX.toFixed(3)
      }]`
    )
    console.log(
      `  Y: [${st.minY === Infinity ? '-' : st.minY.toFixed(3)}, ${
        st.maxY === -Infinity ? '-' : st.maxY.toFixed(3)
      }]`
    )
    console.log(
      `  Z: [${st.minZ === Infinity ? '-' : st.minZ.toFixed(3)}, ${
        st.maxZ === -Infinity ? '-' : st.maxZ.toFixed(3)
      }]`
    )
    console.log(`  max |coord|:               ${st.maxAbs.toExponential(3)}`)
    console.log(
      `  coord magnitude: <1e2:${st.buckets[0]}  <1e4:${st.buckets[1]}  <1e5:${st.buckets[2]}  <1e6:${st.buckets[3]}  <1e8:${st.buckets[4]}  >=1e8:${st.buckets[5]}`
    )
    console.log(
      `  entities by max|coord|: <1e2:${st.entityBucket[0]}  <1e4:${st.entityBucket[1]}  <1e5:${st.entityBucket[2]}  <1e6:${st.entityBucket[3]}  <1e8:${st.entityBucket[4]}  >=1e8:${st.entityBucket[5]}`
    )
  }

  fmt(entities, `ENTITIES section (${section === null ? 'scanned' : 'end'})`)
  fmt(blocks, 'BLOCKS section')

  console.log(
    `\n$EXTMIN(${extHeader.x}, ${extHeader.y}, ${extHeader.z}) from HEADER`
  )

  const sorted = [...layers.entries()].sort((a, b) => b[1].coords - a[1].coords)
  console.log(`\n=== Top 15 layers by coordinate count (of ${layers.size}) ===`)
  for (const [name, s] of sorted.slice(0, 15)) {
    const span = (lo, hi) =>
      lo === Infinity ? '--' : `${lo.toFixed(1)}..${hi.toFixed(1)}`
    console.log(
      `  ${name.padEnd(24)} coords:${String(s.coords).padStart(8)} entities:${String(
        s.entities
      ).padStart(7)}  maxAbs:${s.maxAbs.toExponential(3)}  X:[${span(
        s.minX,
        s.maxX
      )}] Y:[${span(s.minY, s.maxY)}] Z:[${span(s.minZ, s.maxZ)}]`
    )
  }

  const large = sorted.filter(([, s]) => s.maxAbs >= 1e6)
  console.log(`\nLayers containing any |coord| >= 1e6: ${large.length}`)
  for (const [name, s] of large.slice(0, 30)) {
    console.log(
      `  ${name}: maxAbs ${s.maxAbs.toExponential(3)}, ${s.coords} coords, ${s.entities} entities`
    )
  }

  console.log(`\ntotal lines scanned: ${lineNo}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
