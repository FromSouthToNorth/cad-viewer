/**
 * Diagnostics for "conversion never completes + box-select loses layers".
 * Waits for processing=false; while waiting, samples internal counters to see
 * whether conversion is progressing or stalled. Then performs PROGRAMMATIC
 * selection (bypassing mouse events) and deep zoom, reading pixels each time.
 *
 * Usage: node bench/verify-jky3.cjs [file] [baseUrl]
 */
const { chromium } = require('@playwright/test')
const fs = require('fs')
const path = require('path')

const file = process.argv[2] ?? 'jky-small.dxf'
const baseUrl = process.argv[3] ?? 'http://localhost:5173'
const outDir = process.env.OUT_DIR ?? path.join(__dirname, 'out')
const waitMs = Number(process.env.WAIT_MS ?? 240000)

async function internals(page, label) {
  return page.evaluate(label => {
    const view = globalThis['__mlViewDebug']
    if (!view) return { hook: 'missing' }
    const renderer = view['renderer']?.['internalRenderer']
    const scene = view['cadScene']?.['internalScene']
    const camera = view['internalCamera']
    const gl = renderer?.getContext()
    let px = null
    if (renderer && scene && camera && gl) {
      renderer.render(scene, camera)
      const w = gl.drawingBufferWidth
      const h = gl.drawingBufferHeight
      const buf = new Uint8Array(w * h * 4)
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf)
      let nonBg = 0
      for (let i = 0; i < buf.length; i += 4) {
        if (buf[i] > 20 || buf[i + 1] > 20 || buf[i + 2] > 20) nonBg++
      }
      px = { nonBgPct: +((nonBg / (w * h)) * 100).toFixed(2) }
    }
    const info = renderer?.info?.render
    return {
      label,
      px,
      frame: info?.frame,
      lines: info?.lines,
      tris: info?.triangles,
      calls: info?.calls,
      selectionCount: view['selectionSet']?.['count'],
      processing: view['isProcessingEntities'],
      numToProcess: view['_numOfEntitiesToProcess'],
      convertQueue: view['_convertQueue']?.length,
      pendingGeometryJobs: view['_pendingGeometryJobs'],
      totalToProcess: view['_totalEntitiesToProcess'],
      camera: camera ? { zoom: +camera.zoom.toFixed(2), z: +camera.position.z.toFixed(0), near: camera.near, far: +camera.far.toFixed(0) } : null,
      stats: (() => {
        try {
          const s = view['stats']
          return s ? { entityCount: s.entityCount, unbatched: s.unbatchedSize, mesh: s.meshSize, line: s.lineSize } : null
        } catch { return null }
      })()
    }
  }, label)
}

async function wheelZoom(page, dy, steps) {
  await page.mouse.move(640, 400)
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, dy)
    await page.waitForTimeout(150)
  }
  await page.waitForTimeout(800)
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true })
  const browser = await chromium.launch({
    headless: true,
    channel: 'chrome',
    args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--enable-webgl']
  })
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  page.setDefaultTimeout(20000)
  const errors = []
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)) })
  page.on('pageerror', e => errors.push(String(e).slice(0, 300)))

  await page.goto(`${baseUrl}/bench/progressive.html?file=${file}`, { waitUntil: 'domcontentloaded' })

  const t0 = Date.now()
  const samples = []
  while (Date.now() - t0 < waitMs) {
    const s = await internals(page, 'poll').catch(() => null)
    if (s) samples.push(s)
    if (s && s.processing === false) break
    await page.waitForTimeout(3000)
  }
  console.log('samples:', samples.length, 'last:', JSON.stringify(samples[samples.length - 1] ?? null))

  // Programmatic box selection: select every entity whose bbox intersects a
  // central rectangle — same set a mouse drag would produce, but deterministic.
  const selResult = await page.evaluate(() => {
    const view = globalThis['__mlViewDebug']
    if (!view) return 'no-view'
    const box = view['cadScene']?.['box']
    if (!box) return 'no-box'
    const cx = (box.min.x + box.max.x) / 2
    const cy = (box.min.y + box.max.y) / 2
    const w = (box.max.x - box.min.x) / 6
    const h = (box.max.y - box.min.y) / 6
    const q = new (view.constructor.constructor && view['search'] ? Object : Object)()
    const ids = view.search({
      min: { x: cx - w, y: cy - h }, max: { x: cx + w, y: cy + h }
    }, { selectionMode: 'crossing' }).map(i => i.id)
    const unique = [...new Set(ids)]
    view.selectionSet.add(unique)
    return { selected: unique.length, sample: unique.slice(0, 3) }
  })
  console.log('programmatic select:', JSON.stringify(selResult))

  await page.waitForTimeout(1500)
  const afterSelect = await internals(page, 'after-select')
  await page.screenshot({ path: path.join(outDir, 'j3-1-select.png') })
  console.log('after-select:', JSON.stringify(afterSelect))

  await wheelZoom(page, -240, 6)
  const zoomIn = await internals(page, 'zoom-in')
  await page.screenshot({ path: path.join(outDir, 'j3-2-zoom-in.png') })
  console.log('zoom-in:', JSON.stringify(zoomIn))

  await wheelZoom(page, -240, 6)
  const zoomDeep = await internals(page, 'zoom-deep')
  await page.screenshot({ path: path.join(outDir, 'j3-3-zoom-deep.png') })
  console.log('zoom-deep:', JSON.stringify(zoomDeep))

  await page.evaluate(() => { globalThis['__mlViewDebug']?.['selectionSet']?.clear() })
  await page.waitForTimeout(1000)
  const afterClear = await internals(page, 'after-clear')
  await page.screenshot({ path: path.join(outDir, 'j3-4-after-clear.png') })
  console.log('after-clear:', JSON.stringify(afterClear))

  console.log('errors:', JSON.stringify(errors.filter(e => !e.includes('404'))))
  await browser.close()
}

main().catch(e => { console.error('PROBE_FAILED', e); process.exit(1) })
