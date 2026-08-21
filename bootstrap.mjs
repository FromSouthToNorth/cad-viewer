#!/usr/bin/env node
/**
 * 一键初始化 bw-cad-view 联合开发工作区。
 *
 * cad-viewer 通过 pnpm overrides(link:)使用本地的 realdwg-web 包,而这些包必须
 * 先构建出 lib/ 才能被编译。本脚本按正确顺序完成:
 *
 *   1. 安装 realdwg-web 依赖
 *   2. 构建 realdwg-web 的 4 个包(common / geometry-engine / graphic-interface / data-model)
 *   3. 将 cad-viewer 的 overrides 切到本地(link: 实时链接)
 *   4. 安装 cad-viewer 依赖
 *   5. 构建 cad-viewer 全量项目作为验证
 *
 * 之后日常开发:
 *   - 改 realdwg-web 代码 → 在 realdwg-web 里重新构建对应包即可,无需再跑本脚本;
 *     cad-viewer 通过 link: 直接链接源码,重新构建后立即生效(重启 dev server)。
 *   - 新环境克隆本仓库 → 只需在仓库根目录运行: node bootstrap.mjs
 *
 * 不再使用本地联动时:
 *   cd cad-viewer && node tools/use-local-realdwg.mjs --off && pnpm install
 */
import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = dirname(fileURLToPath(import.meta.url))
const realdwgDir = join(rootDir, 'realdwg-web')
const cadViewerDir = join(rootDir, 'cad-viewer')

const REALDWG_PACKAGES =
  '@mlightcad/common @mlightcad/geometry-engine @mlightcad/graphic-interface @mlightcad/data-model'

function run(cmd, cwd) {
  console.log(`\n==> ${cmd}\n`)
  execSync(cmd, { cwd, stdio: 'inherit', shell: true })
}

function step(title) {
  console.log(`\n============================================================`)
  console.log(`  ${title}`)
  console.log(`============================================================`)
}

const nodeMajor = Number(process.versions.node.split('.')[0])
if (nodeMajor < 24) {
  console.warn(
    `提示: cad-viewer 声明要求 Node >= 24,当前为 ${process.version}。` +
      `低版本多数情况下可用,但推荐安装 Node 24 LTS。`
  )
}

if (!existsSync(join(realdwgDir, 'package.json')) || !existsSync(join(cadViewerDir, 'package.json'))) {
  console.error('未找到 realdwg-web/ 或 cad-viewer/ 目录,请在 bw-cad-view 仓库根目录运行本脚本。')
  process.exit(1)
}

step('1/5 安装 realdwg-web 依赖')
run('pnpm install', realdwgDir)

step('2/5 构建 realdwg-web 本地包')
run(`pnpm exec nx run-many -t build -p ${REALDWG_PACKAGES}`, realdwgDir)

step('3/5 切换 cad-viewer overrides 到本地(link:)')
run('node tools/use-local-realdwg.mjs', cadViewerDir)

step('4/5 安装 cad-viewer 依赖')
run('pnpm install', cadViewerDir)

step('5/5 构建 cad-viewer 全量项目(验证)')
run('pnpm build', cadViewerDir)

console.log(`
完成! 常用命令:
  cd cad-viewer
  pnpm dev          # 全功能查看器
  pnpm dev:simple   # 简单查看器

日常联动:
  修改 realdwg-web 后在其目录重新构建对应包(link: 实时生效,无需重装 cad-viewer):
    cd realdwg-web && pnpm exec nx run-many -t build -p ${REALDWG_PACKAGES}
`)
