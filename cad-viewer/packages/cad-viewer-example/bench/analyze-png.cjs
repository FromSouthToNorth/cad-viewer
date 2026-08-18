/**
 * Decodes the out/*.png screenshots and reports pixel statistics per image,
 * plus pairwise diffs against the baseline to quantify visual changes.
 *
 * Usage: node bench/analyze-png.cjs [outDir]
 */
const { chromium } = require('@playwright/test')
const fs = require('fs')
const path = require('path')

const outDir = process.argv[2] ?? path.join(__dirname, 'out')

async function statsOf(page, file) {
  const b64 = fs.readFileSync(path.join(outDir, file)).toString('base64')
  return page.evaluate(async b64 => {
    const img = new Image()
    img.src = 'data:image/png;base64,' + b64
    await img.decode()
    const c = document.createElement('canvas')
    c.width = img.width
    c.height = img.height
    const ctx = c.getContext('2d')
    ctx.drawImage(img, 0, 0)
    const d = ctx.getImageData(0, 0, c.width, c.height).data
    let nonBg = 0
    let colored = 0
    let sum = 0
    const n = d.length / 4
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i]
      const g = d[i + 1]
      const b = d[i + 2]
      sum += (r + g + b) / 3
      if (r > 20 || g > 20 || b > 20) nonBg++
      if (Math.max(r, g, b) - Math.min(r, g, b) > 30) colored++
    }
    return {
      w: c.width,
      h: c.height,
      nonBgPct: +((nonBg / n) * 100).toFixed(2),
      coloredPct: +((colored / n) * 100).toFixed(2),
      meanLuma: +(sum / n).toFixed(1)
    }
  }, b64)
}

async function diffOf(page, a, b) {
  const b64a = fs.readFileSync(path.join(outDir, a)).toString('base64')
  const b64b = fs.readFileSync(path.join(outDir, b)).toString('base64')
  return page.evaluate(async ({ b64a, b64b }) => {
    const load = src =>
      new Promise(resolve => {
        const img = new Image()
        img.onload = () => resolve(img)
        img.src = src
      })
    const [ia, ib] = await Promise.all([
      load('data:image/png;base64,' + b64a),
      load('data:image/png;base64,' + b64b)
    ])
    const c = document.createElement('canvas')
    c.width = ia.width
    c.height = ia.height
    const ctx = c.getContext('2d')
    ctx.drawImage(ia, 0, 0)
    const da = ctx.getImageData(0, 0, c.width, c.height).data
    ctx.drawImage(ib, 0, 0)
    const db = ctx.getImageData(0, 0, c.width, c.height).data
    let changed = 0
    for (let i = 0; i < da.length; i += 4) {
      if (
        Math.abs(da[i] - db[i]) > 24 ||
        Math.abs(da[i + 1] - db[i + 1]) > 24 ||
        Math.abs(da[i + 2] - db[i + 2]) > 24
      ) {
        changed++
      }
    }
    return { changedPct: +((changed / (da.length / 4)) * 100).toFixed(2) }
  }, { b64a, b64b })
}

async function main() {
  const files = fs
    .readdirSync(outDir)
    .filter(f => f.endsWith('.png'))
    .sort()
  const browser = await chromium.launch({ headless: true, channel: 'chrome' })
  const page = await browser.newPage()
  await page.goto('about:blank')

  const report = { files: {} }
  for (const f of files) {
    report.files[f] = await statsOf(page, f)
  }
  const baseline = files.find(f => /^00-|^c0-|^a0-/.test(f))
  if (baseline) {
    report.diffVsBaseline = {}
    for (const f of files) {
      if (f === baseline) continue
      report.diffVsBaseline[f] = await diffOf(page, baseline, f)
    }
  }
  console.log(JSON.stringify(report, null, 2))
  await browser.close()
}

main().catch(error => {
  console.error('ANALYZE_FAILED', error)
  process.exit(1)
})
