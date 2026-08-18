/**
 * A/B isolation: does wheel-zoom alone lose layers, or only zoom after box
 * selection? Samples WebGL pixels (via renderer readback, not drawImage) and
 * renderer stats at every stage.
 *
 * Usage: node bench/verify-ab-zoom.cjs [file] [baseUrl]
 */
const { chromium } = require('@playwright/test')
const fs = require('fs')
const path = require('path')

const file = process.argv[2] ?? 'origin-shift-big.dxf'
const baseUrl = process.argv[3] ?? 'http://localhost:5199'
const outDir = process.env.OUT_DIR ?? path.join(__dirname, 'out')

async function readState(page) {
  return page.evaluate(() => {
    const view = globalThis['__mlViewDebug']
    if (!view) return { hook: 'missing' }
    const renderer = view['renderer']?.['internalRenderer']
    const scene = view['cadScene']
    const camera = view['internalCamera']
    const info = renderer?.info?.render
    // Count visible/rendered batches by walking the scene.
    let visibleObjects = 0
    let totalObjects = 0
    scene?.object?.traverse?.(o => {
      if (o.type === 'Group' && o.children.length === 0) return
      totalObjects++
      if (o.visible) visibleObjects++
    })
    return {
      frame: info?.frame,
      calls: info?.calls,
      lines: info?.lines,
      triangles: info?.triangles,
      points: info?.points,
      camera: camera
        ? {
            z: camera.position.z,
            zoom: camera.zoom,
            near: camera.near,
            far: camera.far
          }
        : null,
      selectionCount: view['selectionSet']?.['count'],
      visibleObjects,
      totalObjects
    }
  })
}

async function readback(page) {
  // WebGL readback of the drawing buffer (works regardless of
  // preserveDrawingBuffer because we render + read in one rAF).
  return page.evaluate(() => {
    const view = globalThis['__mlViewDebug']
    const renderer = view?.['renderer']?.['internalRenderer']
    const canvas = view?.['canvas']
    if (!renderer || !canvas) return null
    const w = canvas.width
    const h = canvas.height
    const gl = renderer.getContext()
    const buf = new Uint8Array(w * h * 4)
    const stats = { nonBg: 0, colored: 0, total: w * h }
    try {
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf)
    } catch (e) {
      return { error: String(e) }
    }
    for (let i = 0; i < buf.length; i += 4) {
      const r = buf[i]
      const g = buf[i + 1]
      const b = buf[i + 2]
      if (r > 20 || g > 20 || b > 20) stats.nonBg++
      if (Math.max(r, g, b) - Math.min(r, g, b) > 30) stats.colored++
    }
    stats.nonBgPct = +((stats.nonBg / stats.total) * 100).toFixed(2)
    stats.coloredPct = +((stats.colored / stats.total) * 100).toFixed(2)
    return stats
  })
}

async function zoomWheel(page, dy, steps) {
  await page.mouse.move(640, 400)
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, dy)
    await page.waitForTimeout(200)
  }
  await page.waitForTimeout(1200)
}

async function boxSelect(page, x0, y0, x1, y1) {
  await page.mouse.move(x0, y0)
  await page.mouse.down()
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(x0 + ((x1 - x0) * i) / 8, y0 + ((y1 - y0) * i) / 8)
    await page.waitForTimeout(50)
  }
  await page.mouse.up()
  await page.waitForTimeout(2000)
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true })
  const browser = await chromium.launch({
    headless: true,
    channel: 'chrome',
    args: [
      '--ignore-gpu-blocklist',
      '--enable-unsafe-swiftshader',
      '--enable-webgl'
    ]
  })
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  const errors = []
  page.on('console', m => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 200))
  })
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)))

  await page.goto(`${baseUrl}/bench/progressive.html?file=${file}`, {
    waitUntil: 'domcontentloaded'
  })
  const t0 = Date.now()
  while (Date.now() - t0 < 300000) {
    const paint = await page.locator('#paint').textContent().catch(() => null)
    if (/processing=false/.test(paint ?? '')) break
    await page.waitForTimeout(2000)
  }
  await page.waitForTimeout(1500)

  const report = {}
  report.stage = {}
  report.stage.open = { state: await readState(page), px: await readback(page) }
  await page.screenshot({ path: path.join(outDir, 'ab-0-open.png') })

  // A: zoom WITHOUT any selection.
  await zoomWheel(page, -240, 6)
  report.stage.zoomNoSelectIn = {
    state: await readState(page),
    px: await readback(page)
  }
  await page.screenshot({ path: path.join(outDir, 'ab-1-zoom-no-select.png') })
  await zoomWheel(page, 240, 8)
  report.stage.zoomNoSelectOut = {
    state: await readState(page),
    px: await readback(page)
  }
  await page.screenshot({ path: path.join(outDir, 'ab-2-zoom-back.png') })

  // B: box select, then same zoom sequence.
  await page.evaluate(() => {
    const view = globalThis['__mlViewDebug']
    if (view) view['mode'] = 0
  })
  await boxSelect(page, 300, 200, 1000, 650)
  report.stage.select = {
    state: await readState(page),
    px: await readback(page)
  }
  await page.screenshot({ path: path.join(outDir, 'ab-3-select.png') })
  await zoomWheel(page, -240, 6)
  report.stage.zoomAfterSelectIn = {
    state: await readState(page),
    px: await readback(page)
  }
  await page.screenshot({ path: path.join(outDir, 'ab-4-zoom-select.png') })
  await zoomWheel(page, 240, 8)
  report.stage.zoomAfterSelectOut = {
    state: await readState(page),
    px: await readback(page)
  }
  await page.screenshot({ path: path.join(outDir, 'ab-5-zoom-select-back.png') })

  // C: clear selection, zoom more, check recovery.
  await page.evaluate(() => {
    globalThis['__mlViewDebug']?.['selectionSet']?.clear()
  })
  await page.waitForTimeout(1000)
  await zoomWheel(page, -240, 4)
  report.stage.afterClearZoom = {
    state: await readState(page),
    px: await readback(page)
  }
  await page.screenshot({ path: path.join(outDir, 'ab-6-after-clear.png') })

  report.errors = errors
  console.log(JSON.stringify(report, null, 2))
  await browser.close()
}

main().catch(error => {
  console.error('AB_FAILED', error)
  process.exit(1)
})
