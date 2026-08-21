#!/usr/bin/env node
/**
 * Guard for the local realdwg-web overrides in pnpm-workspace.yaml.
 *
 * When the overrides point at ../realdwg-web (link:/file:), cad-viewer can
 * only compile if those packages have been built (lib/index.d.ts must exist).
 * Without this check the failure surfaces as a wall of opaque TS2307 errors.
 *
 * Usage:
 *   node scripts/check-local-deps.mjs         # exit 1 when unbuilt
 *   node scripts/check-local-deps.mjs --warn  # warn only, always exit 0
 *   node scripts/check-local-deps.mjs --fix   # auto-build missing packages
 *
 * Wired as prebuild/predev (fail fast) and postinstall --warn in package.json.
 */
import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = new Set(process.argv.slice(2))
const warnOnly = args.has('--warn')
const autoFix = args.has('--fix')

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
    missing.push({ name, dir })
  }
}

if (missing.length === 0) {
  process.exit(0)
}

// ── --fix: auto-build missing packages ──────────────────────

if (autoFix) {
  // Resolve realdwg-web root from the first target's path:
  //   targets look like <root>/realdwg-web/packages/<name>
  const realdwgRoot = resolve(missing[0].dir, '..', '..')
  const missingNames = missing.map(m => m.name).join(' ')

  console.log(`[check-local-deps] 自动构建 ${missing.length} 个缺失包: ${missingNames}`)
  try {
    execSync(`pnpm exec nx run-many -t build -p ${missingNames}`, {
      cwd: realdwgRoot,
      stdio: 'inherit',
      shell: true
    })
    console.log('[check-local-deps] ✓ 构建完成')
    process.exit(0)
  } catch {
    console.error('[check-local-deps] ✗ 自动构建失败,请手动执行:')
    console.error(`  cd ${realdwgRoot}`)
    console.error(`  pnpm exec nx run-many -t build -p ${missingNames}`)
    process.exit(1)
  }
}

// ── Error / Warning output ──────────────────────────────────

const fixHint = [
  '修复方式(三选一):',
  '  1. 自动构建(推荐):',
  '     cd cad-viewer && node scripts/check-local-deps.mjs --fix',
  '  2. 手动构建本地 realdwg-web 包:',
  '     cd realdwg-web && pnpm install',
  '     pnpm exec nx run-many -t build -p @mlightcad/common @mlightcad/geometry-engine',
  '       @mlightcad/graphic-interface @mlightcad/data-model',
  '     (或直接在仓库根目录运行: node bootstrap.mjs)',
  '  3. 不用本地包,切回 npm 源:',
  '     cd cad-viewer && node tools/use-local-realdwg.mjs --off && pnpm install'
].join('\n')

const missingList = missing.map(m => `  - ${m.name}\n    路径: ${m.dir}`).join('\n')
const message = [
  '',
  'realdwg-web 本地依赖尚未构建,以下包缺少 lib/index.d.ts:',
  missingList,
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
