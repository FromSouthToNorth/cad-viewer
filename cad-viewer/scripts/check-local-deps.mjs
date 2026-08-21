#!/usr/bin/env node
/**
 * Guard for the local realdwg-web overrides in pnpm-workspace.yaml.
 *
 * When the overrides point at ../realdwg-web (link:/file:), cad-viewer can
 * only compile if those packages have been built (lib/index.d.ts must exist).
 * Without this check the failure surfaces as a wall of opaque
 * `TS2307: Cannot find module '@mlightcad/data-model'` errors.
 *
 * Usage:
 *   node scripts/check-local-deps.mjs         # exit 1 when unbuilt
 *   node scripts/check-local-deps.mjs --warn  # warn only, always exit 0
 *
 * Wired as prebuild/predev (fail fast) and postinstall --warn in package.json.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const warnOnly = process.argv.includes('--warn')

const LOCAL_PACKAGES = [
  '@mlightcad/common',
  '@mlightcad/geometry-engine',
  '@mlightcad/graphic-interface',
  '@mlightcad/data-model'
]

function localOverrideTargets() {
  const workspaceFile = join(rootDir, 'pnpm-workspace.yaml')
  const content = readFileSync(workspaceFile, 'utf8')
  const targets = {}
  for (const name of LOCAL_PACKAGES) {
    const escaped = name.replace(/\//g, '\\/')
    const match = content.match(new RegExp(`'${escaped}':\\s*'(?:link|file):([^']+)'`))
    if (match) targets[name] = resolve(rootDir, match[1])
  }
  return targets
}

const targets = localOverrideTargets()

// Overrides switched back to the npm registry: nothing local to check.
if (Object.keys(targets).length === 0) {
  process.exit(0)
}

const missing = []
for (const [name, dir] of Object.entries(targets)) {
  if (!existsSync(join(dir, 'lib', 'index.d.ts'))) {
    missing.push(`  - ${name}\n    路径: ${dir}`)
  }
}

if (missing.length > 0) {
  const fixHint = [
    '修复方式(二选一):',
    '  1. 构建本地 realdwg-web 包:',
    '     cd realdwg-web && pnpm install',
    '     pnpm exec nx run-many -t build -p @mlightcad/common @mlightcad/geometry-engine',
    '       @mlightcad/graphic-interface @mlightcad/data-model',
    '     (或直接在仓库根目录运行: node bootstrap.mjs)',
    '  2. 不用本地包,切回 npm 源:',
    '     cd cad-viewer && node tools/use-local-realdwg.mjs --off && pnpm install'
  ].join('\n')

  const message = [
    '',
    'realdwg-web 本地依赖尚未构建,以下包缺少 lib/index.d.ts:',
    ...missing,
    '',
    fixHint,
    ''
  ].join('\n')

  if (warnOnly) {
    console.warn(`[check-local-deps] 警告:${message}`)
    process.exit(0)
  }
  console.error(`[check-local-deps] 错误:${message}`)
  process.exit(1)
}
