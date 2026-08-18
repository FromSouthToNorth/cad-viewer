/**
 * Drives the REAL app shell (App.vue -> MlCadViewer) headless: uploads a DXF
 * through the FileUpload input, waits for the viewer, box-selects, and
 * compares canvas screenshots.
 *
 * Usage: node bench/verify-app-select.cjs [filePath] [baseUrl]
 */
const { chromium } = require('@playwright/test')
const fs = require('fs')
const path = require('path')

const filePath = process.argv[2] ?? path.join(__dirname, 'fixtures', 'anjian.dxf')
const baseUrl = process.argv[3] ?? 'http://localhost:5199'
const outDir = process.env.OUT_DIR ?? path.join(__dirname, 'out')

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

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.upload-dropzone input[type=file]', {
    state: 'attached',
    timeout: 30000
  })
  await page.setInputFiles('.upload-dropzone input[type=file]', filePath)

  // Wait until the viewer mounts (upload screen unmounts).
  await page.waitForSelector('#app-root canvas', { timeout: 120000 }).catch(() => {})
  await page.waitForTimeout(2000)

  // Poll the live doc manager for conversion state.
  const t0 = Date.now()
  let state = null
  while (Date.now() - t0 < 480000) {
    state = await page.evaluate(() => {
      const M = window['AcApDocManager']
      const view = M?.instance?.['curView']
      if (!view) return { phase: 'no-view' }
      const info = view['renderer']?.['internalRenderer']?.info?.render
      const box = view['cadScene']?.['box']
      return {
        phase: 'view',
        processing: view['isProcessingEntities'] ?? null,
        entities: view['stats']?.layouts?.[0]?.summary?.entityCount ?? null,
        frame: info?.frame ?? null,
        sceneBoxZ: box ? [box.min.z, box.max.z] : null,
        camera: view['internalCamera']
          ? {
              z: view['internalCamera'].position.z,
              zoom: view['internalCamera'].zoom,
              near: view['internalCamera'].near,
              far: view['internalCamera'].far
            }
          : null
      }
    })
    if (state?.phase === 'view' && state.processing === false) break
    await page.waitForTimeout(3000)
  }

  await page.screenshot({ path: path.join(outDir, 'a0-open.png') })

  // Switch to selection mode and box-select the canvas center area.
  let selectState = null
  if (state?.phase === 'view') {
    await page.evaluate(() => {
      const view = window['AcApDocManager']?.instance?.['curView']
      if (view) view['mode'] = 0
    })
    const canvas = page.locator('#app-root canvas').first()
    const box = await canvas.boundingBox()
    if (box) {
      const x0 = box.x + box.width * 0.28
      const y0 = box.y + box.height * 0.3
      const x1 = box.x + box.width * 0.72
      const y1 = box.y + box.height * 0.7
      await page.mouse.move(x0, y0)
      await page.mouse.down()
      for (let i = 1; i <= 8; i++) {
        await page.mouse.move(x0 + ((x1 - x0) * i) / 8, y0 + ((y1 - y0) * i) / 8)
        await page.waitForTimeout(60)
      }
      await page.mouse.up()
      await page.waitForTimeout(3000)
    }
    selectState = await page.evaluate(() => {
      const view = window['AcApDocManager']?.instance?.['curView']
      const info = view?.['renderer']?.['internalRenderer']?.info?.render
      return {
        selectionCount: view?.['selectionSet']?.['count'] ?? null,
        frame: info?.frame ?? null
      }
    })
    await page.screenshot({ path: path.join(outDir, 'a1-select.png') })

    // Zoom in/out with the selection active (matches reported repro flow).
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    for (let i = 0; i < 8; i++) {
      await page.mouse.wheel(0, -240)
      await page.waitForTimeout(200)
    }
    await page.waitForTimeout(1500)
    await page.screenshot({ path: path.join(outDir, 'a2-zoom.png') })
  }

  console.log(
    JSON.stringify({ openState: state, selectState, consoleErrors, pageErrors, outDir }, null, 1)
  )
  await browser.close()
}

main().catch(error => {
  console.error('VERIFY_FAILED', error)
  process.exit(1)
})
