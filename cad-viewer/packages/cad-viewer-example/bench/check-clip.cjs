/**
 * Quantifies how much content falls outside the camera clip range after open,
 * comparing the app's (Saved-mode) framing vs the bench (Extents) framing.
 *
 * Usage: node bench/check-clip.cjs [filePath] [baseUrl]
 */
const { chromium } = require('@playwright/test')
const path = require('path')

const filePath = process.argv[2] ?? path.join(__dirname, 'fixtures', 'anjian.dxf')
const baseUrl = process.argv[3] ?? 'http://localhost:5199'

async function runApp() {
  const browser = await chromium.launch({
    headless: true,
    channel: 'chrome',
    args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--enable-webgl']
  })
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  const errors = []
  page.on('pageerror', err => errors.push(String(err).slice(0, 200)))
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.upload-dropzone input[type=file]', { state: 'attached', timeout: 30000 })
  await page.setInputFiles('.upload-dropzone input[type=file]', filePath)
  const t0 = Date.now()
  let state = null
  while (Date.now() - t0 < 480000) {
    state = await page.evaluate(() => {
      const view = window['AcApDocManager']?.instance?.['curView']
      if (!view) return null
      const camera = view['internalCamera']
      const box = view['cadScene']?.['box']
      return {
        processing: view['isProcessingEntities'] ?? true,
        camZ: camera?.position.z,
        near: camera?.near,
        far: camera?.far,
        zoom: camera?.zoom,
        boxZ: box ? [box.min.z, box.max.z] : null
      }
    })
    if (state && state.processing === false && state.camZ != null && state.boxZ != null) break
    await page.waitForTimeout(3000)
  }
  // Let the throttled auto depth-range refresh converge (rAF-driven).
  await page.waitForTimeout(4000)
  const settled = await page.evaluate(() => {
    const view = window['AcApDocManager']?.instance?.['curView']
    const camera = view?.['internalCamera']
    const box = view?.['cadScene']?.['box']
    return {
      camZ: camera?.position.z,
      near: camera?.near,
      far: camera?.far,
      boxZ: box ? [box.min.z, box.max.z] : null
    }
  })
  const clip = await page.evaluate(() => {
    const view = window['AcApDocManager']?.instance?.['curView']
    if (!view) return { error: 'no view' }
    const scene = view['cadScene']
    const camera = view['internalCamera']
    if (!scene || !camera) return { error: 'no scene/camera' }
    const camZ = camera.position.z
    const near = camera.near
    const far = camera.far
    const zLo = camZ - far
    const zHi = camZ - near
    let inRange = 0
    let outRange = 0
    const walk = o => {
      if (o.geometry) {
        const pos = o.geometry.attributes?.position
        if (pos?.array) {
          const arr = pos.array
          const itemSize = pos.itemSize
          o.updateMatrixWorld(true)
          const m = o.matrixWorld.elements
          for (let v = 0; v < pos.count; v++) {
            const wz = m[2] * arr[v * itemSize] + m[6] * arr[v * itemSize + 1] + m[10] * arr[v * itemSize + 2] + m[14]
            if (wz >= zLo && wz <= zHi) inRange++
            else outRange++
          }
        }
      }
      o.children?.forEach(walk)
    }
    walk(scene['internalScene'])
    return { zLo, zHi, inRange, outRange, total: inRange + outRange }
  })
  await browser.close()
  return { state, clip, errors }
}

async function main() {
  const app = await runApp()
  console.log(JSON.stringify(app, null, 1))
}

main().catch(error => {
  console.error('FAIL', error)
  process.exit(1)
})
