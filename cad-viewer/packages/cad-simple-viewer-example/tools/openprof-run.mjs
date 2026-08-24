#!/usr/bin/env node
/**
 * Browser integration verification runner for the perf plan's deferred
 * items (docs/优化计划.md). Starts the cad-simple-viewer-example Vite dev
 * server, drives real browser sessions via Playwright, and prints a JSON
 * report per scenario.
 *
 * Usage (from this directory, pnpm available):
 *   node tools/openprof-run.mjs <scenario> [--save out.json]
 *
 * Scenarios:
 *   m41   M4-1 MTEXT glyph cache: duplicate vs unique vs cache-off
 *         (worker round trips + OPENPROF wall times)
 *   m1    M1 progress overlay monotonicity during progressive open
 *   m24   M2-4 background-tab open timing vs foreground
 *   m3    M3 layer-toggle upload traffic (GL bufferData/bufferSubData spy)
 *   m42   M4-2 box-select timing + highlight texture uploads
 *   m53   M5-3 INSERT rendering-cache profile (slowBlocks)
 *   all   Run every scenario
 *
 * Browser: system Edge via channel 'msedge' (matches existing e2e setup).
 */
import { spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const toolsDir = dirname(fileURLToPath(import.meta.url))
const exampleDir = join(toolsDir, '..')
const repoRoot = join(exampleDir, '..', '..', '..')
const fixturesDir = join(repoRoot, 'realdwg-web', 'tools', 'bench', 'fixtures')

// @playwright/test is a devDependency of cad-viewer-example (the only
// package in this workspace that links it); resolve the launcher from
// there. It re-exports `chromium` from playwright.
const e2eRequire = createRequire(
  join(repoRoot, 'cad-viewer', 'packages', 'cad-viewer-example', 'noop.js')
)
const { chromium } = e2eRequire('@playwright/test')

const PORT = 5176
const BASE_URL = `http://127.0.0.1:${PORT}`

const FIXTURES = {
  utf8: join(fixturesDir, 'utf8-mixed-100000.dxf'),
  gbk: join(fixturesDir, 'gbk-lines-300000.dxf'),
  'mtext-duplicate': join(fixturesDir, 'mtext-duplicate-10000.dxf'),
  'mtext-unique': join(fixturesDir, 'mtext-unique-10000.dxf'),
  'insert-blocks': join(fixturesDir, 'insert-blocks-50000.dxf')
}

// ---------------------------------------------------------------------------
// Dev server
// ---------------------------------------------------------------------------

async function startDevServer() {
  // Spawn vite directly (pnpm is not reliably on PATH in spawned shells).
  const viteBin = join(repoRoot, 'cad-viewer', 'node_modules', 'vite', 'bin', 'vite.js')
  const server = spawn(
    'node',
    [viteBin, '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
    { cwd: exampleDir, stdio: ['ignore', 'pipe', 'pipe'] }
  )
  let output = ''
  server.stdout.on('data', d => {
    output += d.toString()
  })
  server.stderr.on('data', d => {
    output += d.toString()
  })
  const deadline = Date.now() + 180_000
  for (;;) {
    try {
      const res = await fetch(BASE_URL)
      if (res.ok) return { server, getOutput: () => output }
    } catch {
      // not up yet
    }
    if (server.exitCode !== null) {
      throw new Error(`vite exited early (${server.exitCode}):\n${output.slice(-4000)}`)
    }
    if (Date.now() > deadline) {
      throw new Error(`vite did not come up in time:\n${output.slice(-4000)}`)
    }
    await new Promise(r => setTimeout(r, 500))
  }
}

// ---------------------------------------------------------------------------
// Browser helpers
// ---------------------------------------------------------------------------

async function launchBrowser() {
  return chromium.launch({
    channel: 'msedge',
    headless: true,
    args: ['--enable-unsafe-swiftshader']
  })
}

async function newMeasurementContext(browser, { glSpy = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  if (glSpy) {
    await context.addInitScript(() => {
      const w = window
      w.__glUploads = {
        bufferDataBytes: 0,
        bufferDataCalls: 0,
        bufferSubDataBytes: 0,
        bufferSubDataCalls: 0,
        texImageBytes: 0,
        texImageCalls: 0,
        texSubImageBytes: 0,
        texSubImageCalls: 0
      }
      const patch = proto => {
        if (!proto) return
        const bd = proto.bufferData
        proto.bufferData = function (target, data, usage, ...rest) {
          let bytes = 0
          if (data instanceof ArrayBuffer) bytes = data.byteLength
          else if (ArrayBuffer.isView(data)) bytes = data.byteLength
          else bytes = data * 4
          w.__glUploads.bufferDataBytes += bytes
          w.__glUploads.bufferDataCalls++
          return bd.call(this, target, data, usage, ...rest)
        }
        const bsd = proto.bufferSubData
        proto.bufferSubData = function (target, offset, ...rest) {
          const data = rest[rest.length - 2]
          const srcOffset = rest[rest.length - 1]
          let bytes = 0
          if (data instanceof ArrayBuffer) bytes = data.byteLength - srcOffset
          else if (ArrayBuffer.isView(data)) bytes = data.byteLength
          else bytes = 0
          w.__glUploads.bufferSubDataBytes += bytes
          w.__glUploads.bufferSubDataCalls++
          return bsd.call(this, target, offset, data, srcOffset)
        }
        const tex = proto.texImage2D
        proto.texImage2D = function (...args) {
          let bytes = 0
          for (const a of args) {
            if (ArrayBuffer.isView(a) || a instanceof ArrayBuffer) {
              bytes += a.byteLength
            }
          }
          w.__glUploads.texImageBytes += bytes
          w.__glUploads.texImageCalls++
          return tex.apply(this, args)
        }
        const texSub = proto.texSubImage2D
        proto.texSubImage2D = function (...args) {
          let bytes = 0
          for (const a of args) {
            if (ArrayBuffer.isView(a) || a instanceof ArrayBuffer) {
              bytes += a.byteLength
            }
          }
          w.__glUploads.texSubImageBytes += bytes
          w.__glUploads.texSubImageCalls++
          return texSub.apply(this, args)
        }
      }
      patch(window.WebGLRenderingContext?.prototype)
      patch(window.WebGL2RenderingContext?.prototype)
    })
  }
  return context
}

async function newMeasurementContextWithWorkerSpy(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await context.addInitScript(() => {
    const w = window
    w.__mtextWorkerPosts = 0
    w.__mtextWorkers = 0
    const OrigWorker = w.Worker
    w.Worker = class extends OrigWorker {
      constructor(url, options) {
        super(url, options)
        if (String(url).includes('mtext-renderer')) {
          this.__isMtextWorker = true
          w.__mtextWorkers++
        }
      }
      postMessage(...args) {
        if (this.__isMtextWorker) w.__mtextWorkerPosts++
        return super.postMessage(...args)
      }
    }
  })
  return context
}

async function waitFor(page, expr, timeoutMs = 120_000, pollMs = 100) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await page.evaluate(expr)
    if (value) return value
    if (Date.now() > deadline) {
      throw new Error(`timeout waiting for: ${expr.toString().slice(0, 120)}`)
    }
    await new Promise(r => setTimeout(r, pollMs))
  }
}

async function uploadFixture(page, fixturePath) {
  const fileInput = page.locator('input[type="file"]').first()
  await fileInput.waitFor({ state: 'attached', timeout: 60_000 })
  await fileInput.setInputFiles(fixturePath)
}

async function openAndWaitProfile(page, fixturePath) {
  await uploadFixture(page, fixturePath)
  await waitFor(page, () => window.__OPEN_WALL_MS__ !== undefined, 120_000)
  await waitFor(page, () => window.__OPENPROF_DONE__ === true, 180_000)
  return page.evaluate(() => ({
    wallMs: window.__OPEN_WALL_MS__,
    success: window.__OPEN_SUCCESS__,
    entityStats: window.__OPEN_ENTITY_STATS__,
    report: window.__OPENPROF_REPORT__
  }))
}

function parseOpenprofReport(report) {
  if (!report) return null
  const out = {}
  const num = (line, key) => {
    const m = line.match(new RegExp(`${key}:\\s*([\\d.]+)\\s*ms`))
    return m ? Number(m[1]) : undefined
  }
  for (const line of report.split('\n')) {
    if (line.includes('wall clock total:')) out.totalMs = num(line, 'wall clock total')
    if (line.includes('db.read:')) out.readMs = num(line, 'db.read')
    if (line.includes('scene convert:')) out.convertMs = num(line, 'scene convert')
    if (line.includes('PARSE:')) out.parseMs = num(line, 'PARSE')
    if (line.includes('ENTITY flush:')) out.entityMs = num(line, 'ENTITY flush')
    if (line.includes('hits:')) out.cacheHits = Number(line.match(/hits:\s*(\d+)/)?.[1])
    if (line.includes('misses:')) out.cacheMisses = Number(line.match(/misses:\s*(\d+)/)?.[1])
  }
  return out
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

async function scenarioM41(browser) {
  const results = {}
  for (const kind of ['duplicate', 'unique']) {
    const context = await newMeasurementContextWithWorkerSpy(browser)
    const page = await context.newPage()
    await page.goto(`${BASE_URL}/?openprof=1&worker=1&hooks=1`)
    await page.waitForLoadState('networkidle').catch(() => {})
    const profile = await openAndWaitProfile(page, FIXTURES[`mtext-${kind}`])
    results[kind] = await page.evaluate(async () => ({
      workerPosts: window.__mtextWorkerPosts,
      workersCreated: window.__mtextWorkers,
      cacheStats: window.__cadDebugHooks.mtextCacheStats()
    }))
    results[kind].profile = parseOpenprofReport(profile.report)
    await context.close()
  }

  // Cache-off duplicate run: same workload, cache disabled before open.
  {
    const context = await newMeasurementContextWithWorkerSpy(browser)
    const page = await context.newPage()
    await page.goto(`${BASE_URL}/?openprof=1&worker=1&hooks=1`)
    await page.waitForLoadState('networkidle').catch(() => {})
    await page.evaluate(() => window.__cadDebugHooks.setMtextCacheEnabled(false))
    const profile = await openAndWaitProfile(page, FIXTURES['mtext-duplicate'])
    results['duplicate-cache-off'] = await page.evaluate(async () => ({
      workerPosts: window.__mtextWorkerPosts,
      workersCreated: window.__mtextWorkers,
      cacheStats: window.__cadDebugHooks.mtextCacheStats()
    }))
    results['duplicate-cache-off'].profile = parseOpenprofReport(profile.report)
    await context.close()
  }
  return results
}

async function scenarioM1(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await context.addInitScript(() => {
    const w = window
    w.__progressSamples = []
    const sample = () => {
      const label = document.querySelector('.ml-ccl-progress-label')
      const container = document.querySelector('.ml-ccl-progress')
      const message = document.querySelector('.ml-ccl-message')
      if (label) {
        w.__progressSamples.push({
          t: performance.now(),
          text: label.textContent,
          visible: container ? getComputedStyle(container).display !== 'none' : false,
          stage: message && getComputedStyle(message).display !== 'none' ? message.textContent : ''
        })
      }
    }
    const iv = setInterval(sample, 40)
    w.__stopProgressSampling = () => clearInterval(iv)
  })
  const page = await context.newPage()
  await page.goto(`${BASE_URL}/?openprof=1&progressive=1`)
  await page.waitForLoadState('networkidle').catch(() => {})
  await openAndWaitProfile(page, FIXTURES.utf8)
  const samples = await page.evaluate(() => {
    window.__stopProgressSampling()
    return window.__progressSamples
  })

  // Analyze monotonicity of the *visible* percentage sequence.
  let violations = 0
  let peak = -1
  let sawPeakHide = false
  let lastVisible = -1
  let hidAfterPeak = false
  for (const s of samples) {
    if (!s.visible) {
      if (lastVisible >= 0) hidAfterPeak = true
      continue
    }
    const value = Number.parseInt(s.text, 10)
    if (Number.isNaN(value)) continue
    if (lastVisible >= 0 && value < lastVisible) {
      violations++
      if (violations <= 3) console.warn(`M1 violation: ${lastVisible}% -> ${value}% at ${s.t.toFixed(0)}ms`)
    }
    lastVisible = value
    peak = Math.max(peak, value)
  }
  const shown = samples.filter(s => s.visible).map(s => Number.parseInt(s.text, 10)).filter(Number.isFinite)
  return {
    sampleCount: samples.length,
    shownValues: shown,
    firstShown: shown[0] ?? null,
    maxShown: peak,
    reached100: peak === 100,
    monotonic: violations === 0,
    hidAfterPeak,
    stageTexts: [...new Set(samples.map(s => s.stage).filter(Boolean))]
  }
}

async function scenarioM24(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })

  // Background page first (it stays hidden once foreground page is brought up).
  const bg = await context.newPage()
  await bg.goto(`${BASE_URL}/?openprof=1`)
  await bg.waitForLoadState('networkidle').catch(() => {})

  const fg = await context.newPage()
  await fg.goto(`${BASE_URL}/?openprof=1`)
  await fg.waitForLoadState('networkidle').catch(() => {})
  await fg.bringToFront()

  // Prove the background page is actually rAF-throttled before opening.
  const rafDeltas = await bg.evaluate(async () => {
    const deltas = []
    for (let i = 0; i < 12; i++) {
      const t0 = performance.now()
      await new Promise(resolve => requestAnimationFrame(() => resolve()))
      deltas.push(performance.now() - t0)
    }
    return { deltas, hidden: document.hidden }
  })

  const [bgProfile, fgProfile] = await Promise.all([
    openAndWaitProfile(bg, FIXTURES.utf8),
    openAndWaitProfile(fg, FIXTURES.utf8)
  ])
  return {
    backgroundHidden: rafDeltas.hidden,
    backgroundRafDeltasMs: rafDeltas.deltas.map(d => Number(d.toFixed(1))),
    background: {
      wallMs: bgProfile.wallMs,
      profile: parseOpenprofReport(bgProfile.report)
    },
    foreground: {
      wallMs: fgProfile.wallMs,
      profile: parseOpenprofReport(fgProfile.report)
    }
  }
}

async function scenarioM3(browser) {
  const context = await newMeasurementContext(browser, { glSpy: true })
  const page = await context.newPage()
  await page.goto(`${BASE_URL}/?hooks=1`)
  await page.waitForLoadState('networkidle').catch(() => {})
  await uploadFixture(page, FIXTURES.gbk)
  await waitFor(page, () => window.__cadDebugHooks.sceneBusy() === false, 300_000)

  const before = await page.evaluate(() => ({
    layers: window.__cadDebugHooks.layerNames(),
    renderer: window.__cadDebugHooks.rendererInfo(),
    uploads: { ...window.__glUploads }
  }))

  const reset = () =>
    page.evaluate(() => {
      const u = window.__glUploads
      for (const k of Object.keys(u)) u[k] = 0
    })

  await reset()
  await page.evaluate(() => window.__cadDebugHooks.setLayerOn('图层', false))
  await page.waitForTimeout(2000)
  const offUploads = await page.evaluate(() => ({ ...window.__glUploads }))

  await reset()
  await page.evaluate(() => window.__cadDebugHooks.setLayerOn('图层', true))
  await page.waitForTimeout(2000)
  const onUploads = await page.evaluate(() => ({ ...window.__glUploads }))

  return {
    layers: before.layers,
    rendererInfo: before.renderer,
    uploadsAtIdle: before.uploads,
    turnOff: offUploads,
    turnOn: onUploads
  }
}

async function scenarioM42(browser) {
  const context = await newMeasurementContext(browser, { glSpy: true })
  const page = await context.newPage()
  const selectionLogs = []
  page.on('console', msg => {
    if (msg.text().includes('[cad-selection]')) selectionLogs.push(msg.text())
  })
  await page.goto(`${BASE_URL}/?hooks=1`)
  await page.waitForLoadState('networkidle').catch(() => {})
  await uploadFixture(page, FIXTURES.gbk)
  await waitFor(page, () => window.__cadDebugHooks.sceneBusy() === false, 300_000)
  await page.waitForTimeout(1000)

  const fullBoxMs = await page.evaluate(() =>
    window.__cadDebugHooks.selectByBox(-1e9, -1e9, 1e9, 1e9, 'crossing', 'replace')
  )
  await page.waitForTimeout(1500)
  const fullBoxUploads = await page.evaluate(() => ({ ...window.__glUploads }))

  await page.evaluate(() => {
    const u = window.__glUploads
    for (const k of Object.keys(u)) u[k] = 0
  })
  const emptyBoxMs = await page.evaluate(() =>
    window.__cadDebugHooks.selectByBox(-2e9, -2e9, -1.9e9, -1.9e9, 'crossing', 'replace')
  )
  await page.waitForTimeout(1500)
  const emptyBoxUploads = await page.evaluate(() => ({ ...window.__glUploads }))

  return {
    selectionLogs,
    fullBoxMs,
    fullBoxUploads,
    emptyBoxMs,
    emptyBoxUploads
  }
}

async function scenarioM53(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  await page.goto(`${BASE_URL}/?openprof=1&hooks=1`)
  await page.waitForLoadState('networkidle').catch(() => {})
  const profile = await openAndWaitProfile(page, FIXTURES['insert-blocks'])
  return {
    wallMs: profile.wallMs,
    entityStats: profile.entityStats,
    profile: parseOpenprofReport(profile.report),
    report: profile.report
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const scenarioArg = process.argv[2] ?? 'all'
const saveArgIndex = process.argv.indexOf('--save')
const savePath = saveArgIndex >= 0 ? process.argv[saveArgIndex + 1] : null

const SCENARIOS = {
  m41: scenarioM41,
  m1: scenarioM1,
  m24: scenarioM24,
  m3: scenarioM3,
  m42: scenarioM42,
  m53: scenarioM53
}

if (scenarioArg !== 'all' && !SCENARIOS[scenarioArg]) {
  console.error(`unknown scenario "${scenarioArg}" (m41|m1|m24|m3|m42|m53|all)`)
  process.exit(1)
}

const report = {
  generatedAt: new Date().toISOString(),
  scenario: scenarioArg,
  results: {}
}

const { server, getOutput } = await startDevServer()
const browser = await launchBrowser()
try {
  const names = scenarioArg === 'all' ? Object.keys(SCENARIOS) : [scenarioArg]
  for (const name of names) {
    console.error(`\n=== scenario ${name} ===`)
    try {
      report.results[name] = await SCENARIOS[name](browser)
    } catch (error) {
      report.results[name] = { error: String(error?.stack ?? error) }
      console.error(`scenario ${name} failed:`, error)
    }
  }
} finally {
  await browser.close().catch(() => {})
  server.kill()
}

const json = JSON.stringify(report, null, 2)
if (savePath) {
  await writeFile(savePath, json + '\n')
  console.error(`saved report to ${savePath}`)
}
console.log(json)
