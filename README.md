# CAD 大图纸性能优化工作区

本仓库是 [mlightcad/cad-viewer](https://github.com/mlightcad/cad-viewer) 与
[mlightcad/realdwg-web](https://github.com/mlightcad/realdwg-web) 的本地联合开发工作区,
将两个项目并列检出、通过 pnpm overrides 本地联动,用于大图纸(煤矿采掘工程平面图等)
加载与渲染性能的联合优化。

## 项目组成

| 目录 | 说明 |
| --- | --- |
| `cad-viewer/` | 纯浏览器端 DWG/DXF 查看器与编辑器(解析、几何处理、渲染全部在浏览器内完成,无后端依赖) |
| `realdwg-web/` | DWG/DXF 解析核心,仿 AutoCAD ObjectARX 的 API 设计,提供 `data-model`、`geometry-engine`、`graphic-interface` 等包 |
| `data/` | 大图纸测试数据(真实矿图 DXF,含 95MB、38 万实体的 `JKYHMKA01A01yh3m.dxf`) |
| `docs/` | [性能优化总结](./docs/性能优化总结.md)(根因分析、已实施优化、遗留工作) |

两个子目录是独立检出的 git 仓库,由父仓库以 gitlink(提交哈希)固定版本。

## 环境要求

- [Node.js](https://nodejs.org/) >= 24
- [pnpm](https://pnpm.io/) >= 10

## 快速开始

```bash
# 1. 安装两个仓库的依赖
cd realdwg-web && pnpm install
cd ../cad-viewer && pnpm install

# 2. 构建 realdwg-web 的本地包(本地联动依赖已构建产物)
cd ../realdwg-web
pnpm --filter @mlightcad/common build
pnpm --filter @mlightcad/geometry-engine build
pnpm --filter @mlightcad/graphic-interface build
pnpm --filter @mlightcad/data-model build

# 3. 将 cad-viewer 的 @mlightcad/* 依赖切换到本地 realdwg-web
cd ../cad-viewer
node tools/use-local-realdwg.mjs
pnpm install

# 4. 启动查看器
pnpm dev          # 全功能查看器
pnpm dev:simple   # 简单查看器
```

## 本地联动(cad-viewer ↔ realdwg-web)

`cad-viewer/tools/use-local-realdwg.mjs` 通过修改 `cad-viewer/pnpm-workspace.yaml` 的
overrides,把 `@mlightcad/data-model` 等包在 npm 源与本地 `../realdwg-web` 检出之间切换:

```bash
cd cad-viewer
node tools/use-local-realdwg.mjs         # 切到本地检出(需先构建,见上文)
node tools/use-local-realdwg.mjs --off   # 切回 npm 源
REALDWG_WEB_DIR=../../realdwg-web node tools/use-local-realdwg.mjs  # 自定义路径
```

修改 realdwg-web 代码后需重新构建对应包并重启 dev server。
**发布或提交前必须执行 `--off` 还原 overrides 并重新 `pnpm install`。**

## 性能测试

基准与诊断脚本位于 `realdwg-web/tools/bench/`:

```bash
cd realdwg-web
node tools/bench/generate-large-dxf.mjs   # 生成大文件夹具(lines/lwpolylines/circles/mixed/bigcoords 等)
node tools/bench/bench-parse.cjs          # 解析基准(bestMs/avgMs/peakHeapMB/entities,结果存 baseline.json)
node tools/bench/scan-coords.cjs          # DXF 坐标分布扫描(大坐标诊断用)
```

浏览器端渐进式渲染 A/B 基准:`cad-viewer/packages/cad-viewer-example/bench/progressive.html`。

真实大图纸位于 `data/`(煤矿矿图,mxdraw 生成,GBK 编码),其中
`JKYHMKA01A01yh3m.dxf`(95MB、389,328 实体、坐标千万级)是当前优化的目标文件。

## 测试

```bash
cd realdwg-web && pnpm test                       # data-model 等包(821/821)
cd ../cad-viewer && pnpm --filter @mlightcad/cad-simple-viewer test   # 简单查看器(358/358)
```

## 文档

- [docs/性能优化总结.md](./docs/性能优化总结.md):本次大图纸优化的背景、根因、已实施改动(M0–M2)、基准数据与遗留工作(M3+)
- [docs/架构图.md](./docs/架构图.md):项目流程图与架构图(工作区结构、DXF/DWG 解析管线、渐进式渲染流程、类结构、基准工具链,Mermaid 绘制)
- [cad-viewer/README.md](./cad-viewer/README.md)(含中/日/韩/西/葡/俄/捷克等多语言版本)
- [realdwg-web/README.md](./realdwg-web/README.md):解析核心的 API、转换器注册机制与许可证说明

## 注意事项

1. 两个子目录为独立 git 检出(gitlink 固定),克隆父仓库后需按对应哈希手动检出,且各自的改动在其子仓库内提交。
2. `cad-viewer/pnpm-workspace.yaml` 的本地 overrides 属于开发期配置,**发布前必须还原**(见上文)。
3. 本机为软件渲染环境(无真实 GPU),渲染类优化(如大坐标原点平移)需在真实 GPU 环境验证。

## License

本工作区仅聚合上游项目,不改变其许可证:

- [cad-viewer](./cad-viewer/LICENSE):MIT
- [realdwg-web](./realdwg-web/LICENSE):MIT 为主,其中 `@mlightcad/libredwg-converter` 为 GPL-3.0
  (LibreDWG 解析器需以独立 Web Worker 方式部署以隔离许可证,详见其 README)
