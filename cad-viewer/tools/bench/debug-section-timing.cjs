#!/usr/bin/env node
/**
 * Section-level timing: scan the DXF with a bare filer, timing each SECTION.
 * Pinpoints which section stalls before any document-reader logic runs.
 *
 * Usage:
 *   node tools/bench/debug-section-timing.cjs <file.dxf>
 */
'use strict'

const { readFile } = require('node:fs/promises')
const { AcDbDxfFiler } = require('@mlightcad/data-model')

async function main() {
  const file = process.argv[2]
  const buffer = await readFile(file)
  const t0 = Date.now()
  const mark = (label) => {
    console.log(`[${((Date.now() - t0) / 1000).toFixed(2)}s] ${label}`)
  }
  mark('start')

  const filer = AcDbDxfFiler.fromBuffer(buffer)
  mark('filer created')

  let section = '(preamble)'
  let sectionStart = Date.now()
  let pairsInSection = 0
  let inSection = false

  // Follow the document reader's section-discovery loop: (0, SECTION) then (2, NAME).
  while (!filer.atEof) {
    const item = filer.readItem()
    if (!item) break
    if (Number(item.code) !== 0) {
      pairsInSection++
      continue
    }
    const name = String(item.value).toUpperCase()
    if (name === 'EOF') break

    if (name === 'SECTION') {
      if (inSection) {
        mark(`end ${section}: ${pairsInSection} pairs in ${((Date.now() - sectionStart) / 1000).toFixed(2)}s`)
      }
      const nameItem = filer.readItem()
      section = nameItem && Number(nameItem.code) === 2 ? String(nameItem.value).toUpperCase() : '(unnamed)'
      sectionStart = Date.now()
      pairsInSection = 0
      inSection = true
      mark(`begin SECTION ${section}`)
      continue
    }

    if (name === 'ENDSEC') {
      mark(`end ${section}: ${pairsInSection} pairs in ${((Date.now() - sectionStart) / 1000).toFixed(2)}s`)
      inSection = false
      pairsInSection = 0
      continue
    }

    // Entity boundary inside a section — log every 100k pairs to show progress.
    pairsInSection++
    if (pairsInSection % 1000000 === 0) {
      mark(`  ${section}: ${pairsInSection} pairs so far`)
    }
  }
  mark('done')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
