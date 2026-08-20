/**
 * Headless reproduction for "click selection shows vertex markers on every
 * selected entity instead of only the last picked one".
 *
 * Two modes:
 * - `progressive` (default): progressive bench page in READ mode; inspects the
 *   WebGL vertex marker overlay point count.
 * - `write`: same bench page opened in WRITE mode (HTML grips active, WebGL
 *   markers yield); inspects the grip manager entries.
 *
 * In both modes two entities are click-selected one after the other and the
 * marker/grip driver state is reported after each click.
 *
 * Usage: node bench/verify-click-select.cjs [file] [baseUrl] [mode]
 */
const { chromium } = require('@playwright/test')
const fs = require('fs')
const path = require('path')

const file = process.argv[2] ?? 'jky-small.dxf'
const baseUrl = process.argv[3] ?? 'http://localhost:5173'
const mode = process.argv[4] ?? 'progressive'
const outDir = process.env.OUT_DIR ?? path.join(__dirname, 'out')

async function readState(page) {
  return page.evaluate(() => {
    const view =
      globalThis['__mlViewDebug'] ??
      window['AcApDocManager']?.instance?.['curView']
    if (!view) return { hook: 'missing' }
    const overlay = view['cadScene']?.['_selectionMarkerOverlay']
    const posAttr = overlay?.['internalObject']?.geometry?.attributes?.position
    const gripEntries = (view['_gripManager']?.['_entries'] ?? []).map(e => ({
      entityId: e.entityId,
      gripIndex: e.gripIndex
    }))
    const cache = view['selectionVertexMarkers']?.['_pointsCache']
    const cacheSizes = {}
    if (cache && typeof cache.forEach === 'function') {
      cache.forEach((pts, id) => {
        cacheSizes[id] = pts.length
      })
    }
    return {
      hook: 'present',
      mode: view['mode'],
      selectionCount: view['selectionSet']?.['count'],
      selectionIds: view['selectionSet']?.['ids'] ?? [],
      lastPicked: view['lastPickedEntityId'] ?? null,
      markerPointCount: posAttr ? posAttr.count : null,
      gripEntryCount: gripEntries.length,
      gripEntityIds: gripEntries.map(e => e.entityId),
      cacheSizes
    }
  })
}

async function findEntityPositions(page, count) {
  return page.evaluate(async count => {
    const view =
      globalThis['__mlViewDebug'] ??
      window['AcApDocManager']?.instance?.['curView']
    const canvas = view['canvas']
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    const found = []
    const seen = new Set()
    for (let y = 90; y < h - 40 && found.length < count; y += 48) {
      for (let x = 40; x < w - 40 && found.length < count; x += 48) {
        const wcs = view['screenToWorld']({ x, y })
        const picked = view['pick'](wcs)
        if (picked && picked.length > 0) {
          const id = picked[0].id
          if (!seen.has(id)) {
            seen.add(id)
            found.push({ x, y, id })
          }
        }
      }
    }
    return found
  }, count)
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

  const writeParam = mode === 'write' ? '&mode=write' : ''
  await page.goto(
    `${baseUrl}/bench/progressive.html?file=${file}${writeParam}`,
    { waitUntil: 'domcontentloaded' }
  )

  const readPaint = () =>
    page.locator('#paint').textContent().catch(() => null)
  const readBar = () => page.locator('#bar').textContent().catch(() => null)

  const t0 = Date.now()
  let done = false
  while (Date.now() - t0 < 240000) {
    const paint = await readPaint()
    const bar = await readBar()
    if (paint && bar) {
      const processing = /processing=(true|false)/.exec(paint)?.[1]
      const renderCalls = Number(/renderCalls=(\d+)/.exec(paint)?.[1] ?? NaN)
      if (processing === 'false' && renderCalls > 0) {
        done = true
        break
      }
    }
    await page.waitForTimeout(2000)
  }
  if (!done) {
    console.log(JSON.stringify({ result: 'open-timeout', mode }))
    await browser.close()
    return
  }

  const baseline = await readState(page)
  const positions = await findEntityPositions(page, 2)
  if (positions.length < 2) {
    console.log(
      JSON.stringify({ result: 'not-enough-entities', mode, baseline, positions })
    )
    await browser.close()
    return
  }

  const [a, b] = positions

  // Plain click entity A (pointer selection defaults to 'add').
  await page.mouse.click(a.x, a.y)
  await page.waitForTimeout(400)
  const afterA = await readState(page)
  await page.screenshot({
    path: path.join(outDir, `click-select-${mode}-a.png`)
  })

  // Plain click entity B.
  await page.mouse.click(b.x, b.y)
  await page.waitForTimeout(400)
  const afterB = await readState(page)
  await page.screenshot({
    path: path.join(outDir, `click-select-${mode}-b.png`)
  })

  const gripA = afterA.cacheSizes[a.id] ?? 0
  const gripB = afterB.cacheSizes[b.id] ?? 0

  console.log(
    JSON.stringify(
      {
        result: 'done',
        mode,
        file,
        baseline: {
          selectionCount: baseline.selectionCount,
          markerPointCount: baseline.markerPointCount,
          gripEntryCount: baseline.gripEntryCount
        },
        clickA: {
          id: a.id,
          gripPoints: gripA,
          selectionIds: afterA.selectionIds,
          lastPicked: afterA.lastPicked,
          markerPointCount: afterA.markerPointCount,
          gripEntryCount: afterA.gripEntryCount
        },
        clickB: {
          id: b.id,
          gripPoints: gripB,
          selectionIds: afterB.selectionIds,
          lastPicked: afterB.lastPicked,
          markerPointCount: afterB.markerPointCount,
          gripEntryCount: afterB.gripEntryCount,
          gripEntityIds: afterB.gripEntityIds
        },
        expect: {
          selectionKeepsBoth: afterB.selectionIds.length === 2,
          lastPickedEqualsB: afterB.lastPicked === b.id,
          markersYieldInWrite:
            mode === 'write' ? afterB.markerPointCount === null : true,
          markersOnlyB:
            mode === 'write'
              ? true
              : gripB > 0 && afterB.markerPointCount === gripB,
          notMarkingAAndB:
            mode === 'write'
              ? true
              : afterB.markerPointCount !== gripA + gripB,
          gripsOnlyB:
            mode === 'write'
              ? afterB.gripEntryCount > 0 &&
                afterB.gripEntityIds.every(id => id === b.id)
              : true,
          notGrippingAAndB:
            mode === 'write' ? !afterB.gripEntityIds.includes(a.id) : true
        },
        consoleErrors,
        pageErrors
      },
      null,
      2
    )
  )
  await browser.close()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
