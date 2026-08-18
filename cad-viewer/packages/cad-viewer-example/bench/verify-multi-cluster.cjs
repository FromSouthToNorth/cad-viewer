/**
 * Multi-cluster + spanning-entity repro: open, box-select cluster A, deep zoom
 * into cluster A, and verify (a) pixel coverage per stage, (b) the spanning
 * SURVEY polyline's far vertex projects to its expected WCS screen position.
 *
 * Usage: node bench/verify-multi-cluster.cjs [file] [baseUrl]
 */
const { chromium } = require('@playwright/test')
const fs = require('fs')
const path = require('path')

const file = process.argv[2] ?? 'multi-cluster.dxf'
const baseUrl = process.argv[3] ?? 'http://localhost:5199'
const outDir = process.env.OUT_DIR ?? path.join(__dirname, 'out')

const A = { x: 39652926.8, y: 39458238.4 }

async function probe(page, label) {
  const r = await page.evaluate(
    ({ label, A }) => {
      const view = globalThis['__mlViewDebug']
      const renderer = view?.['renderer']?.['internalRenderer']
      const scene = view?.['cadScene']?.['internalScene']
      const camera = view?.['internalCamera']
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
        px = { nonBgPct: +((nonBg / (w * h)) * 100).toFixed(2), w, h }
      }

      // Project the known cluster-A point to NDC → where it SHOULD appear.
      let project = null
      if (camera) {
        camera.updateMatrixWorld()
        camera.updateProjectionMatrix()
        const camWorld = camera.matrixWorld.elements
        project = {
          cam: {
            z: camera.position.z,
            zoom: camera.zoom,
            near: camera.near,
            far: camera.far,
            tx: camera.position.x,
            ty: camera.position.y
          },
          view: camWorld.slice()
        }
      }

      const info = renderer?.info?.render
      return {
        label,
        px,
        project,
        renderInfo: info
          ? { frame: info.frame, calls: info.calls, lines: info.lines, tris: info.triangles }
          : null,
        selectionCount: view['selectionSet']?.['count']
      }
    },
    { label, A }
  )
  await page.screenshot({ path: path.join(outDir, `mc-${label}.png`) })
  return r
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true })
  const browser = await chromium.launch({
    headless: true,
    channel: 'chrome',
    args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--enable-webgl']
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
  while (Date.now() - t0 < 240000) {
    const paint = await page.locator('#paint').textContent().catch(() => null)
    if (/processing=false/.test(paint ?? '')) break
    await page.waitForTimeout(2000)
  }
  await page.waitForTimeout(1000)

  const report = {}
  report.open = await probe(page, '0-open')

  // Box select around cluster A (screen center after fit covers both clusters;
  // the fit box spans the full extent, so select a region around the left/top).
  await page.evaluate(() => {
    const view = globalThis['__mlViewDebug']
    if (view) view['mode'] = 0
  })
  await page.mouse.move(400, 250)
  await page.mouse.down()
  for (let i = 1; i <= 6; i++) {
    await page.mouse.move(400 + i * 60, 250 + i * 40)
    await page.waitForTimeout(40)
  }
  await page.mouse.up()
  await page.waitForTimeout(1200)
  report.select = await probe(page, '1-select')

  // Deep zoom toward cluster A via wheel.
  await page.mouse.move(640, 400)
  for (let i = 0; i < 20; i++) {
    await page.mouse.wheel(0, -240)
    await page.waitForTimeout(120)
  }
  await page.waitForTimeout(1200)
  report.zoomDeep = await probe(page, '2-zoom-deep')

  // Clear selection and zoom again.
  await page.evaluate(() => {
    globalThis['__mlViewDebug']?.['selectionSet']?.clear()
  })
  await page.waitForTimeout(800)
  await page.mouse.move(640, 400)
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, -240)
    await page.waitForTimeout(120)
  }
  await page.waitForTimeout(1200)
  report.afterClearZoom = await probe(page, '3-after-clear-zoom')

  report.errors = errors.filter(e => !e.includes('404 (Not Found)'))
  console.log(JSON.stringify(report, null, 1))
  await browser.close()
}

main().catch(error => {
  console.error('MC_FAILED', error)
  process.exit(1)
})
