/**
 * Headless browser verification for the build-time origin-shift fix (M3).
 *
 * Loads the progressive bench page against the local dev server, opens a DXF
 * fixture, and reports:
 *  - console errors / page errors
 *  - whether the view completed conversion (processing=false)
 *  - renderer render() call count and batched point count (proves painting)
 *  - whether wheel-zoom still produces new render calls (no freeze at zoom)
 *
 * Usage: node tools/verify-origin-shift.cjs [file] [baseUrl]
 */
const { chromium } = require('@playwright/test')

const file = process.argv[2] ?? 'smoke.dxf'
const baseUrl = process.argv[3] ?? 'http://localhost:5199'
const pollIntervalMs = 2000
const openTimeoutMs = Number(process.env.OPEN_TIMEOUT_MS ?? 240000)

async function main() {
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

  const samples = []
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
      samples.push({ ms: Date.now() - t0, paint, bar })
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

  const beforeZoom = await readPaint()
  const beforeBar = await readBar()

  // Wheel-zoom over the canvas center and confirm the renderer keeps painting
  // (animation loop alive, frame counter keeps advancing, no page errors).
  let afterZoom = beforeZoom
  let afterBar = beforeBar
  if (done) {
    await page.mouse.move(640, 400)
    for (let i = 0; i < 12; i++) {
      await page.mouse.wheel(0, -240)
      await page.waitForTimeout(250)
    }
    await page.waitForTimeout(1500)
    afterZoom = await readPaint()
    afterBar = await readBar()
  }

  // Deep introspection through the bench page debug hook.
  let debug = null
  try {
    debug = await page.evaluate(() => {
      const view = globalThis['__mlViewDebug']
      if (!view) return { hook: 'missing' }
      const box = view['cadScene']?.['box']
      const camera = view['internalCamera']
      const info = view['renderer']?.['internalRenderer']?.info
      const sceneStats = view['stats']
      return {
        hook: 'present',
        viewName: view.constructor?.name,
        sceneStats,
        renderInfo: info?.render,
        sceneBox: box
          ? { minZ: box.min.z, maxZ: box.max.z }
          : null,
        camera: camera
          ? {
              z: camera.position.z,
              near: camera.near,
              far: camera.far,
              zoom: camera.zoom
            }
          : null
      }
    })
  } catch (error) {
    debug = { evaluateError: String(error) }
  }

  const framesOf = s => Number(/frames=(\d+)/.exec(s)?.[1] ?? NaN)
  const gapOf = s => Number(/maxFrameGap=(\d+)/.exec(s)?.[1] ?? NaN)
  const okOf = s => /ok=(\w+)/.exec(s)?.[1] ?? null
  const statsOf = s => ({
    entities: Number(/entities=(\d+)/.exec(s)?.[1] ?? NaN),
    meshSize: Number(/meshSize=(\d+)/.exec(s)?.[1] ?? NaN),
    lineSize: Number(/lineSize=(\d+)/.exec(s)?.[1] ?? NaN),
    unbatched: Number(/unbatched=(\d+)/.exec(s)?.[1] ?? NaN)
  })
  console.log(
    JSON.stringify(
      {
        file,
        completed: done,
        openOk: okOf(lastBar ?? ''),
        debug,
        elapsedMs: Date.now() - t0,
        lastSample,
        lastStats: statsOf(lastSample ?? ''),
        sampleCount: samples.length,
        firstSample: samples[0]?.paint ?? null,
        consoleErrors: consoleErrors.filter(
          e => !e.includes('favicon') && !e.includes('404 (Not Found)')
        ),
        pageErrors,
        zoom: {
          before: beforeZoom,
          after: afterZoom,
          beforeBar,
          afterBar,
          framesAdvanced: framesOf(beforeBar ?? '') < framesOf(afterBar ?? ''),
          maxFrameGapAfter: gapOf(afterBar ?? '')
        }
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
