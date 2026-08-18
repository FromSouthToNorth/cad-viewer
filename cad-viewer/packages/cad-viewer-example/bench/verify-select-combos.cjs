/**
 * Stress combinations: box-select then zoom/pan, and selection during
 * progressive open. Reports pixel coverage + renderer state at each stage.
 *
 * Usage: node bench/verify-select-combos.cjs [file] [baseUrl]
 */
const { chromium } = require('@playwright/test')
const fs = require('fs')
const path = require('path')

const file = process.argv[2] ?? 'origin-shift-big.dxf'
const baseUrl = process.argv[3] ?? 'http://localhost:5199'
const outDir = process.env.OUT_DIR ?? path.join(__dirname, 'out')

async function pixelStats(page, name) {
  const s = await page.evaluate(() => {
    const view = globalThis['__mlViewDebug']
    const canvas = view?.['canvas']
    if (!canvas) return null
    const tmp = document.createElement('canvas')
    tmp.width = 320
    tmp.height = 200
    const ctx = tmp.getContext('2d')
    ctx.drawImage(canvas, 0, 0, 320, 200)
    const img = ctx.getImageData(0, 0, 320, 200).data
    let nonBg = 0
    let colored = 0
    for (let i = 0; i < img.length; i += 4) {
      const r = img[i]
      const g = img[i + 1]
      const b = img[i + 2]
      if (r > 20 || g > 20 || b > 20) nonBg++
      if (Math.max(r, g, b) - Math.min(r, g, b) > 30) colored++
    }
    const info = view['renderer']?.['internalRenderer']?.info?.render
    return {
      nonBgPct: +((nonBg / (320 * 200)) * 100).toFixed(1),
      coloredPct: +((colored / (320 * 200)) * 100).toFixed(1),
      frame: info?.frame,
      camera: view['internalCamera']
        ? {
            z: view['internalCamera'].position.z,
            zoom: view['internalCamera'].zoom,
            near: view['internalCamera'].near,
            far: view['internalCamera'].far
          }
        : null,
      selectionCount: view['selectionSet']?.['count']
    }
  })
  await page.screenshot({ path: path.join(outDir, name) })
  return s
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
  const consoleErrors = []
  const pageErrors = []
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 300))
  })
  page.on('pageerror', err => pageErrors.push(String(err).slice(0, 300)))

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
  report.baseline = await pixelStats(page, 'c0-baseline.png')

  // Box select a large area.
  await page.evaluate(() => {
    const view = globalThis['__mlViewDebug']
    if (view) view['mode'] = 0
  })
  await page.mouse.move(300, 200)
  await page.mouse.down()
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(300 + i * 85, 200 + i * 45)
    await page.waitForTimeout(50)
  }
  await page.mouse.up()
  await page.waitForTimeout(2000)
  report.afterSelect = await pixelStats(page, 'c1-select.png')

  // Wheel zoom in with the selection active.
  await page.mouse.move(640, 400)
  for (let i = 0; i < 10; i++) {
    await page.mouse.wheel(0, -240)
    await page.waitForTimeout(200)
  }
  await page.waitForTimeout(1500)
  report.afterZoomIn = await pixelStats(page, 'c2-zoom-in.png')

  // Wheel zoom back out.
  for (let i = 0; i < 14; i++) {
    await page.mouse.wheel(0, 240)
    await page.waitForTimeout(200)
  }
  await page.waitForTimeout(1500)
  report.afterZoomOut = await pixelStats(page, 'c3-zoom-out.png')

  // Pan drag with selection active.
  await page.mouse.move(640, 400)
  await page.mouse.down()
  await page.mouse.move(840, 500, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(1500)
  report.afterPan = await pixelStats(page, 'c4-pan.png')

  // Clear selection, then zoom again.
  await page.evaluate(() => {
    globalThis['__mlViewDebug']?.['selectionSet']?.clear()
  })
  await page.waitForTimeout(1000)
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, -240)
    await page.waitForTimeout(200)
  }
  await page.waitForTimeout(1500)
  report.afterClearZoom = await pixelStats(page, 'c5-clear-zoom.png')

  report.consoleErrors = consoleErrors.filter(
    e => !e.includes('favicon') && !e.includes('404 (Not Found)')
  )
  report.pageErrors = pageErrors
  console.log(JSON.stringify(report, null, 1))
  await browser.close()
}

main().catch(error => {
  console.error('VERIFY_FAILED', error)
  process.exit(1)
})
