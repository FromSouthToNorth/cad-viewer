/**
 * Headless reproduction for "box selection makes layers disappear".
 *
 * Loads the progressive bench page, opens a DXF fixture, then performs a real
 * mouse-drag box selection across a large canvas region (selection mode) and
 * reports render/selection state before/after plus screenshots.
 *
 * Usage: node bench/verify-box-select.cjs [file] [baseUrl]
 */
const { chromium } = require('@playwright/test')
const fs = require('fs')
const path = require('path')

const file = process.argv[2] ?? 'origin-shift.dxf'
const baseUrl = process.argv[3] ?? 'http://localhost:5199'
const outDir = process.env.OUT_DIR ?? path.join(__dirname, 'out')
const pollIntervalMs = 2000
const openTimeoutMs = Number(process.env.OPEN_TIMEOUT_MS ?? 240000)

async function readDebug(page) {
  return page.evaluate(() => {
    const view = globalThis['__mlViewDebug']
    if (!view) return { hook: 'missing' }
    const info = view['renderer']?.['internalRenderer']?.info
    const box = view['cadScene']?.['box']
    let layers = null
    try {
      layers = view['cadScene']?.['layers']?.map(l => ({
        name: l.name,
        entityCount: l.entityCount,
        visible: l.visible
      }))
    } catch {
      layers = 'n/a'
    }
    return {
      hook: 'present',
      mode: view['mode'],
      selectionCount: view['selectionSet']?.['count'],
      selectionIds: (view['selectionSet']?.['ids'] ?? []).slice(0, 5),
      renderInfo: info?.render,
      sceneBox: box ? { minZ: box.min.z, maxZ: box.max.z } : null,
      camera: view['internalCamera']
        ? {
            z: view['internalCamera'].position.z,
            near: view['internalCamera'].near,
            far: view['internalCamera'].far,
            zoom: view['internalCamera'].zoom
          }
        : null,
      layerSample: Array.isArray(layers) ? layers.slice(0, 8) : layers,
      layerCount: Array.isArray(layers) ? layers.length : null
    }
  })
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
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text().slice(0, 300))
    }
  })
  page.on('pageerror', err => pageErrors.push(String(err).slice(0, 300)))

  await page.goto(`${baseUrl}/bench/progressive.html?file=${file}`, {
    waitUntil: 'domcontentloaded'
  })

  const readPaint = () =>
    page.locator('#paint').textContent().catch(() => null)
  const readBar = () => page.locator('#bar').textContent().catch(() => null)

  const t0 = Date.now()
  let done = false
  let lastSample = null
  let lastBar = null
  while (Date.now() - t0 < openTimeoutMs) {
    const paint = await readPaint()
    const bar = await readBar()
    if (paint) lastSample = paint
    if (bar) lastBar = bar
    if (paint && bar) {
      const processing = /processing=(true|false)/.exec(paint)?.[1]
      const renderCalls = Number(
        /renderCalls=(\d+)/.exec(paint)?.[1] ?? NaN
      )
      if (processing === 'false' && renderCalls > 0) {
        done = true
        break
      }
    }
    await page.waitForTimeout(pollIntervalMs)
  }

  const baseline = done ? await readDebug(page) : null
  if (done) {
    await page.screenshot({ path: path.join(outDir, '00-baseline.png') })
  }

  // Switch to selection mode and perform a real box-select drag.
  let dragPerformed = false
  let afterSelect = null
  let afterClear = null
  if (done) {
    dragPerformed = true
    await page.evaluate(() => {
      const view = globalThis['__mlViewDebug']
      if (view) view['mode'] = 0 // AcEdViewMode.SELECTION
    })
    await page.waitForTimeout(300)
    const x0 = 360
    const y0 = 240
    const x1 = 920
    const y1 = 560
    await page.mouse.move(x0, y0)
    await page.mouse.down()
    // drag in steps so mousemove preview updates fire
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(x0 + ((x1 - x0) * i) / 10, y0 + ((y1 - y0) * i) / 10)
      await page.waitForTimeout(60)
    }
    await page.mouse.up()
    await page.waitForTimeout(3000)
    afterSelect = await readDebug(page)
    await page.screenshot({ path: path.join(outDir, '01-after-select.png') })

    // Clear the selection to check the unhighlight path restores the scene.
    await page.evaluate(() => {
      globalThis['__mlViewDebug']?.['selectionSet']?.clear()
    })
    await page.waitForTimeout(3000)
    afterClear = await readDebug(page)
    await page.screenshot({ path: path.join(outDir, '02-after-clear.png') })
  }

  const paintAfter = await readPaint()
  const barAfter = await readBar()

  console.log(
    JSON.stringify(
      {
        file,
        completed: done,
        dragPerformed,
        baseline,
        afterSelect,
        afterClear,
        paintAfter,
        barAfter,
        consoleErrors: consoleErrors.filter(
          e => !e.includes('favicon') && !e.includes('404 (Not Found)')
        ),
        pageErrors,
        outDir
      },
      null,
      2
    )
  )

  await browser.close()
}

main().catch(error => {
  console.error('VERIFY_FAILED', error)
  process.exit(1)
})
