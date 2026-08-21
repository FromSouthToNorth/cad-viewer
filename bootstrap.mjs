#!/usr/bin/env node
/**
 * 一键初始化 bw-cad-view 联合开发工作区(增量、幂等)。
 *
 * 默认行为:检测每一步的完成状态,已完成的步骤自动跳过。
 *
 * 用法:
 *   node bootstrap.mjs           # 增量初始化(跳过已完成步骤)
 *   node bootstrap.mjs --fast    # 跳过最终验证构建,直接可用于开发
 *   node bootstrap.mjs --force   # 强制重跑所有步骤(忽略已完成状态)
 *
 * 之后日常开发:
 *   - 改 realdwg-web 代码 → 重新构建对应包即可,无需重装 cad-viewer
 *   - 新环境克隆本仓库 → 只需在仓库根目录运行: node bootstrap.mjs
 *
 * 不再使用本地联动时:
 *   cd cad-viewer && node tools/use-local-realdwg.mjs --off && pnpm install
 */
import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = dirname(fileURLToPath(import.meta.url))
const realdwgDir = join(rootDir, 'realdwg-web')
const cadViewerDir = join(rootDir, 'cad-viewer')

const REALDWG_PACKAGES = [
  '@mlightcad/common',
  '@mlightcad/geometry-engine',
  '@mlightcad/graphic-interface',
  '@mlightcad/data-model'
]
const REALDWG_PACKAGES_STR = REALDWG_PACKAGES.join(' ')

const args = new Set(process.argv.slice(2))
const fastMode = args.has('--fast')
const forceMode = args.has('--force')

function run(cmd, cwd) {
  execSync(cmd, { cwd, stdio: 'inherit', shell: true })
}

function step(index, total, title) {
  console.log(`\n━━━ [${index}/${total}] ${title} ━━━`)
}

/** 检查 realdwg-web 某个包是否已构建(lib/index.d.ts 存在) */
function isPackageBuilt(pkgName) {
  const shortName = pkgName.split('/')[1]
  return existsSync(join(realdwgDir, 'packages', shortName, 'lib', 'index.d.ts'))
}

/** 检查 pnpm-workspace.yaml 是否已切到本地 link: 模式 */
function isLocalOverrideActive() {
  try {
    const content = readFileSync(join(cadViewerDir, 'pnpm-workspace.yaml'), 'utf8')
    return content.includes("'@mlightcad/data-model': 'link:")
  } catch {
    return false
  }
}

// ── 前置检查 ──────────────────────────────────────────────────

const nodeMajor = Number(process.versions.node.split('.')[0])
if (nodeMajor < 24) {
  console.warn(
    `⚠ Node ${process.version} — cad-viewer 声明要求 >= 24,推荐使用 Node 24 LTS。`
  )
}

if (!existsSync(join(realdwgDir, 'package.json')) || !existsSync(join(cadViewerDir, 'package.json'))) {
  console.error('错误: 未找到 realdwg-web/ 或 cad-viewer/ 目录,请在 bw-cad-view 仓库根目录运行。')
  process.exit(1)
}

// ── 主流程 ──────────────────────────────────────────────────

const totalSteps = fastMode ? 4 : 5
let stepIndex = 0
let skippedCount = 0
const startTime = Date.now()

function elapsed() {
  const s = ((Date.now() - startTime) / 1000).toFixed(1)
  return `${s}s`
}

// Step 1: 安装 realdwg-web 依赖
stepIndex++
step(stepIndex, totalSteps, '安装 realdwg-web 依赖')
if (!forceMode && existsSync(join(realdwgDir, 'node_modules'))) {
  console.log('  ⏭ 已存在 node_modules,跳过 (--force 可强制重装)')
  skippedCount++
} else {
  run('pnpm install', realdwgDir)
  console.log('  ✓ 完成')
}

// Step 2: 构建 realdwg-web 本地包
stepIndex++
step(stepIndex, totalSteps, '构建 realdwg-web 本地包')
const allBuilt = REALDWG_PACKAGES.every(isPackageBuilt)
if (!forceMode && allBuilt) {
  console.log('  ⏭ 4 个包均已构建,跳过 (--force 可强制重构建)')
  skippedCount++
} else {
  run(`pnpm exec nx run-many -t build -p ${REALDWG_PACKAGES_STR}`, realdwgDir)
  console.log('  ✓ 完成')
}

// Step 3: 切换 cad-viewer overrides 到本地
stepIndex++
step(stepIndex, totalSteps, '切换 cad-viewer 到本地联动(link:)')
if (!forceMode && isLocalOverrideActive()) {
  console.log('  ⏭ 已是本地联动模式,跳过')
  skippedCount++
} else {
  run('node tools/use-local-realdwg.mjs', cadViewerDir)
  console.log('  ✓ 完成')
}

// Step 4: 安装 cad-viewer 依赖
stepIndex++
step(stepIndex, totalSteps, '安装 cad-viewer 依赖')
if (!forceMode && existsSync(join(cadViewerDir, 'node_modules'))) {
  console.log('  ⏭ 已存在 node_modules,跳过 (--force 可强制重装)')
  skippedCount++
} else {
  run('pnpm install', cadViewerDir)
  console.log('  ✓ 完成')
}

// Step 5: 构建 cad-viewer(验证)
if (!fastMode) {
  stepIndex++
  step(stepIndex, totalSteps, '构建 cad-viewer 全量项目(验证)')
  run('pnpm build', cadViewerDir)
  console.log('  ✓ 完成')
}

// ── 总结 ──────────────────────────────────────────────────

const skippedMsg = skippedCount > 0 ? `(跳过 ${skippedCount} 步)` : ''
console.log(`\n✅ 初始化完成 ${skippedMsg}  耗时 ${elapsed()}`)

if (fastMode) {
  console.log(`
快速启动:
  cd cad-viewer
  pnpm dev          # 全功能查看器
  pnpm dev:simple   # 简单查看器

提示: 首次启动 dev 时 Vite 会自动预构建依赖,后续热更新更快。
日常联动: 修改 realdwg 后重新构建对应包即可,无需重装 cad-viewer:
  cd realdwg-web && pnpm exec nx run-many -t build -p ${REALDWG_PACKAGES_STR}`)
} else {
  console.log(`
启动开发服务器:
  cd cad-viewer
  pnpm dev          # 全功能查看器
  pnpm dev:simple   # 简单查看器

日常联动: 修改 realdwg 后重新构建对应包,重启 dev server 即可:
  cd realdwg-web && pnpm exec nx run-many -t build -p ${REALDWG_PACKAGES_STR}

提示: 使用 --fast 可跳过验证构建,加快首次初始化速度。`)
}
