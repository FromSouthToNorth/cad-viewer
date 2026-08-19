#!/usr/bin/env node
/**
 * Switch example apps / CLI from @mlightcad/libredwg-converter (GPL)
 * to the proprietary @mlight-cad/dwg-converter (private maintainer clone
 * at packages/dwg-converter, outside the pnpm workspace / public lockfile).
 *
 * `@mlightcad/cad-simple-viewer` no longer depends on or registers a DWG
 * converter — hosts (examples, CLI) own that opt-in.
 *
 * Usage (from repo root):
 *   node tools/use-dwg-converter.mjs
 *   pnpm use:dwg-converter
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const toolsDir = dirname(fileURLToPath(import.meta.url))
const rootDir = join(toolsDir, '..')

const DWG_CONVERTER_VERSION = 'link:../dwg-converter'

const FROM_PKG = '@mlightcad/libredwg-converter'
const TO_PKG = '@mlight-cad/dwg-converter'
const CODEPAGE_SRC = `./node_modules/${TO_PKG}/dist/dwg-codepage-*.bin`

/**
 * Insert dwg-codepage-*.bin viteStaticCopy target after the converter
 * worker target. Uses line splitting so CRLF/LF both work.
 */
function ensureCodepageCopyTarget(content) {
  if (content.includes('dwg-codepage-*.bin')) {
    return content
  }

  const nl = content.includes('\r\n') ? '\r\n' : '\n'
  const lines = content.split(/\r?\n/)
  const workerLineIdx = lines.findIndex(line =>
    line.includes(`${TO_PKG}/dist/*-worker.js`)
  )
  if (workerLineIdx === -1) {
    console.warn('  could not locate worker copy target; add dwg-codepage-*.bin manually')
    return content
  }

  let closeIdx = -1
  for (let i = workerLineIdx; i < lines.length; i++) {
    if (/^[ \t]*\}$/.test(lines[i])) {
      closeIdx = i
      break
    }
  }
  if (closeIdx === -1) {
    return content
  }

  const indent = lines[closeIdx].match(/^[ \t]*/)[0]
  const propIndent = `${indent}  `
  lines[closeIdx] = `${indent}},`
  lines.splice(
    closeIdx + 1,
    0,
    `${indent}{`,
    `${propIndent}src: '${CODEPAGE_SRC}',`,
    `${propIndent}dest: 'assets'`,
    `${indent}}`
  )
  return lines.join(nl)
}

function replaceLibreDwgParserWorkerFile(content) {
  if (
    content.includes('DWG_PARSER_WORKER_FILE') &&
    !content.includes('LIBREDWG_PARSER_WORKER_FILE')
  ) {
    console.log('  already using DWG_PARSER_WORKER_FILE')
    return null
  }

  const next = content.replaceAll(
    'LIBREDWG_PARSER_WORKER_FILE',
    'DWG_PARSER_WORKER_FILE'
  )

  if (next === content) {
    throw new Error('No LIBREDWG_PARSER_WORKER_FILE found to replace')
  }
  return next
}

function replacePackageDep(content) {
  if (
    content.includes('"@mlight-cad/dwg-converter"') &&
    !content.includes('"@mlightcad/libredwg-converter"')
  ) {
    console.log('  already using @mlight-cad/dwg-converter')
    return null
  }

  const next = content.replace(
    /"@mlightcad\/libredwg-converter"\s*:\s*"[^"]*"/,
    `"@mlight-cad/dwg-converter": "${DWG_CONVERTER_VERSION}"`
  )

  if (next === content) {
    throw new Error('Expected @mlightcad/libredwg-converter in package.json')
  }
  return next
}

function replaceViteLibreDwg(content) {
  if (
    content.includes('DWG_CONVERTER_PACKAGE') &&
    !content.includes('LIBREDWG_CONVERTER_PACKAGE')
  ) {
    console.log('  already using DWG_CONVERTER_PACKAGE')
    return null
  }

  let next = content
  next = next.replaceAll('LIBREDWG_CONVERTER_PACKAGE', 'DWG_CONVERTER_PACKAGE')
  next = next.replaceAll('LIBREDWG_PARSER_WORKER_FILE', 'DWG_PARSER_WORKER_FILE')
  next = next.replaceAll('LIBREDWG_PARSER_WASM_FILE', 'DWG_PARSER_MAIN_FILE')
  // Proprietary converter may not ship a sibling wasm; drop wasm-only copy blocks
  // left with an empty/mismatched asset — hosts should adjust manually if needed.

  if (next === content) {
    throw new Error('No LIBREDWG_* symbols found in vite.config.ts to replace')
  }
  return next
}

function replaceRegisterModule(content) {
  if (
    content.includes('AcDbDwgConverter') &&
    !content.includes('AcDbLibreDwgConverter')
  ) {
    console.log('  already using AcDbDwgConverter')
    return null
  }

  let next = content
  next = next.replaceAll(
    "from '@mlightcad/libredwg-converter'",
    "from '@mlight-cad/dwg-converter'"
  )
  next = next.replaceAll('AcDbLibreDwgConverter', 'AcDbDwgConverter')
  next = next.replaceAll('registerLibreDwgConverter', 'registerDwgConverter')
  next = next.replaceAll('LIBREDWG_PARSER_WORKER_FILE', 'DWG_PARSER_WORKER_FILE')
  next = next.replaceAll(
    '`@mlightcad/libredwg-converter`',
    '`@mlight-cad/dwg-converter`'
  )

  if (next === content) {
    throw new Error(
      'No AcDbLibreDwgConverter / libredwg-converter found in register module'
    )
  }
  return next
}

const targets = [
  {
    path: join(
      rootDir,
      'packages',
      'cad-simple-viewer-example',
      'package.json'
    ),
    label: 'cad-simple-viewer-example/package.json',
    transform: replacePackageDep
  },
  {
    path: join(rootDir, 'packages', 'cad-viewer-example', 'package.json'),
    label: 'cad-viewer-example/package.json',
    transform: replacePackageDep
  },
  {
    path: join(rootDir, 'packages', 'cad-simple-viewer-cli', 'package.json'),
    label: 'cad-simple-viewer-cli/package.json',
    transform: replacePackageDep
  },
  {
    path: join(rootDir, 'packages', 'realdwg-web-example', 'package.json'),
    label: 'realdwg-web-example/package.json',
    transform: replacePackageDep
  },
  {
    path: join(
      rootDir,
      'packages',
      'cad-simple-viewer-example',
      'vite.config.ts'
    ),
    label: 'cad-simple-viewer-example/vite.config.ts',
    transform: replaceViteLibreDwg
  },
  {
    path: join(rootDir, 'packages', 'cad-viewer-example', 'vite.config.ts'),
    label: 'cad-viewer-example/vite.config.ts',
    transform: replaceViteLibreDwg
  },
  {
    path: join(rootDir, 'packages', 'realdwg-web-example', 'vite.config.ts'),
    label: 'realdwg-web-example/vite.config.ts',
    transform(content) {
      if (content.includes(TO_PKG)) {
        console.log('  already using @mlight-cad/dwg-converter')
        return null
      }
      if (!content.includes(FROM_PKG)) {
        throw new Error('No libredwg-converter reference found in vite.config.ts')
      }
      return ensureCodepageCopyTarget(content.replaceAll(FROM_PKG, TO_PKG))
    }
  },
  {
    path: join(
      rootDir,
      'packages',
      'cad-simple-viewer-cli',
      'scripts',
      'copy-runner-assets.mjs'
    ),
    label: 'cad-simple-viewer-cli/scripts/copy-runner-assets.mjs',
    transform: replaceViteLibreDwg
  },
  {
    path: join(
      rootDir,
      'packages',
      'cad-simple-viewer-example',
      'src',
      'registerLibreDwg.ts'
    ),
    label: 'cad-simple-viewer-example/src/registerLibreDwg.ts',
    transform: replaceRegisterModule
  },
  {
    path: join(
      rootDir,
      'packages',
      'cad-viewer-example',
      'src',
      'registerLibreDwg.ts'
    ),
    label: 'cad-viewer-example/src/registerLibreDwg.ts',
    transform: replaceRegisterModule
  },
  {
    path: join(
      rootDir,
      'packages',
      'cad-simple-viewer-example',
      'src',
      'main.ts'
    ),
    label: 'cad-simple-viewer-example/src/main.ts',
    transform(content) {
      let next = replaceLibreDwgParserWorkerFile(content)
      if (next == null) {
        next = content
      }
      const replaced = next
        .replaceAll('registerLibreDwgConverter', 'registerDwgConverter')
        .replaceAll('./registerLibreDwg', './registerLibreDwg')
      if (replaced === content && next === content) {
        console.log('  already switched')
        return null
      }
      return replaced
    }
  },
  {
    path: join(rootDir, 'packages', 'cad-viewer-example', 'src', 'main.ts'),
    label: 'cad-viewer-example/src/main.ts',
    transform(content) {
      let next = replaceLibreDwgParserWorkerFile(content)
      if (next == null) {
        next = content
      }
      const replaced = next.replaceAll(
        'registerLibreDwgConverter',
        'registerDwgConverter'
      )
      if (replaced === content && next === content) {
        console.log('  already switched')
        return null
      }
      return replaced
    }
  },
  {
    path: join(
      rootDir,
      'packages',
      'cad-simple-viewer-cli',
      'runner',
      'main.ts'
    ),
    label: 'cad-simple-viewer-cli/runner/main.ts',
    transform(content) {
      if (
        content.includes('AcDbDwgConverter') &&
        !content.includes('AcDbLibreDwgConverter')
      ) {
        console.log('  already using AcDbDwgConverter')
        return null
      }

      let next = content
      next = next.replaceAll(
        "from '@mlightcad/libredwg-converter'",
        "from '@mlight-cad/dwg-converter'"
      )
      next = next.replaceAll('AcDbLibreDwgConverter', 'AcDbDwgConverter')
      next = next.replaceAll(
        'LIBREDWG_PARSER_WORKER_FILE',
        'DWG_PARSER_WORKER_FILE'
      )

      if (next === content) {
        throw new Error('No libredwg references found in CLI runner/main.ts')
      }
      return next
    }
  },
  {
    path: join(rootDir, 'packages', 'realdwg-web-example', 'src', 'main.ts'),
    label: 'realdwg-web-example/src/main.ts',
    transform(content) {
      if (
        content.includes('AcDbDwgConverter') &&
        !content.includes('AcDbLibreDwgConverter')
      ) {
        console.log('  already using AcDbDwgConverter')
        return null
      }
      const next = content
        .replaceAll(FROM_PKG, TO_PKG)
        .replaceAll('AcDbLibreDwgConverter', 'AcDbDwgConverter')
        .replaceAll('libredwg-parser-worker.js', 'dwg-parser-worker.js')
      if (next === content) {
        throw new Error('No libredwg references found in realdwg-web-example main.ts')
      }
      return next
    }
  },
  {
    path: join(rootDir, 'packages', 'dwg-converter', 'package.json'),
    label: 'dwg-converter/package.json',
    optional: true,
    transform(content) {
      // dwg-converter is outside the pnpm workspace / public lockfile, so it
      // cannot use workspace:* — point it at the in-repo data-model build.
      const next = content.replace(
        /"(@mlightcad\/data-model)"\s*:\s*"(?!link:\.\.\/data-model)[^"]*"/g,
        '"$1": "link:../data-model"'
      )
      if (next === content) {
        console.log('  already using link:../data-model')
        return null
      }
      return next
    }
  }
]

function main() {
  console.log(
    'Switching example/CLI DWG path to @mlight-cad/dwg-converter…'
  )

  let changed = 0
  for (const target of targets) {
    if (target.optional && !existsSync(target.path)) {
      continue
    }
    console.log(`\n→ ${target.label}`)
    const original = readFileSync(target.path, 'utf8')
    const updated = target.transform(original)
    if (updated == null) {
      continue
    }
    writeFileSync(target.path, updated, 'utf8')
    console.log(`  updated ${target.path}`)
    changed++
  }

  console.log(
    changed === 0
      ? '\nNothing to change (already switched).'
      : `\nDone. Updated ${changed} file(s). Run pnpm install if package.json changed.`
  )
}

main()
