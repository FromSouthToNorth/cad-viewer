/**
 * Deep probe: synchronous render + readPixels at each stage, plus per-layer
 * and per-batch diagnostics to determine WHY content disappears after box
 * select + zoom.
 *
 * Usage: node bench/verify-deep-probe.cjs [file] [baseUrl]
 */
const { chromium } = require('@playwright/test')
const fs = require('fs')
const path = require('path')

const file = process.argv[2] ?? 'origin-shift-big.dxf'
const baseUrl = process.argv[3] ?? 'http://localhost:5199'
const outDir = process.env.OUT_DIR ?? path.join(__dirname, 'out')

async function probe(page, label) {
  const result = await page.evaluate(label => {
    const view = globalThis['__mlViewDebug']
    if (!view) return { hook: 'missing' }
    const renderer = view['renderer']?.['internalRenderer']
    const scene = view['cadScene']?.['internalScene']
    const camera = view['internalCamera']
    const canvas = view['canvas']
    const gl = renderer?.getContext()

    // Synchronous draw + readback so preserveDrawingBuffer doesn't matter.
    let px = null
    if (renderer && scene && camera && gl) {
      renderer.render(scene, camera)
      const w = gl.drawingBufferWidth
      const h = gl.drawingBufferHeight
      const buf = new Uint8Array(w * h * 4)
      let ok = true
      try {
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf)
      } catch (e) {
        ok = false
      }
      let nonBg = 0
      let colored = 0
      for (let i = 0; i < buf.length; i += 4) {
        const r = buf[i]
        const g = buf[i + 1]
        const b = buf[i + 2]
        if (r > 20 || g > 20 || b > 20) nonBg++
        if (Math.max(r, g, b) - Math.min(r, g, b) > 30) colored++
      }
      px = {
        ok,
        w,
        h,
        nonBgPct: +((nonBg / (w * h)) * 100).toFixed(2),
        coloredPct: +((colored / (w * h)) * 100).toFixed(2)
      }
    }

    // Per-layer + per-batch diagnostics.
    const layers = []
    try {
      const cadScene = view['cadScene']
      const sceneLayers = cadScene?.['layers'] ?? []
      for (const info of sceneLayers) {
        const layerName = info.name
        // layout -> AcTrLayer -> internalObject (batched group)
        const layout = cadScene['activeLayout']
        const acLayer = layout?.['getLayer']?.(layerName)
        const group = acLayer?.['internalObject']
        let children = 0
        let visibleChildren = 0
        let totalVerts = 0
        group?.traverse?.(o => {
          if (o.isMesh || o.isLine || o.isLineSegments2 || o.isLineSegments || o.isPoints) {
            children++
            if (o.visible) visibleChildren++
            const pos = o.geometry?.attributes?.position
            if (pos) totalVerts += pos.count
          }
        })
        layers.push({
          name: layerName,
          layerVisible: acLayer?.visible,
          groupVisible: group?.visible,
          children,
          visibleChildren,
          totalVerts
        })
      }
    } catch (e) {
      layers.push({ error: String(e).slice(0, 120) })
    }

    const info = renderer?.info?.render
    return {
      label,
      px,
      camera: camera
        ? {
            z: camera.position.z,
            zoom: camera.zoom,
            near: camera.near,
            far: camera.far,
            tx: camera.position.x,
            ty: camera.position.y
          }
        : null,
      renderInfo: info
        ? { frame: info.frame, calls: info.calls, lines: info.lines, tris: info.triangles, points: info.points }
        : null,
      selectionCount: view['selectionSet']?.['count'],
      layers
    }
  }, label)
  await page.screenshot({ path: path.join(outDir, `dp-${label}.png`) })
  return result
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
  await page.waitForTimeout(1200)

  const report = {}
  report.open = await probe(page, '0-open')

  // Select via API first (no mouse), then zoom, to isolate highlight effect.
  await page.evaluate(() => {
    const view = globalThis['__mlViewDebug']
    if (view) view['mode'] = 0
  })
  await page.mouse.move(300, 200)
  await page.mouse.down()
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(300 + i * 85, 200 + i * 45)
    await page.waitForTimeout(40)
  }
  await page.mouse.up()
  await page.waitForTimeout(1500)
  report.select = await probe(page, '1-select')

  await wheelZoom(page, -240, 6)
  report.zoomIn = await probe(page, '2-zoom-in')

  await wheelZoom(page, -240, 6)
  report.zoomInDeep = await probe(page, '3-zoom-in-deep')

  await wheelZoom(page, 240, 12)
  report.zoomOut = await probe(page, '4-zoom-out')

  await page.evaluate(() => {
    globalThis['__mlViewDebug']?.['selectionSet']?.clear()
  })
  await page.waitForTimeout(1000)
  await wheelZoom(page, -240, 6)
  report.afterClearZoom = await probe(page, '5-after-clear-zoom')

  report.errors = errors.filter(e => !e.includes('404 (Not Found)'))
  console.log(JSON.stringify(report, null, 1))
  await browser.close()
}

main().catch(error => {
  console.error('PROBE_FAILED', error)
  process.exit(1)
})
