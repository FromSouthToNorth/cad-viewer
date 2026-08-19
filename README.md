# CAD 大图纸性能优化工作区

本仓库是 [mlightcad/cad-viewer](https://github.com/mlightcad/cad-viewer) 的本地开发工作区,
原 [mlightcad/realdwg-web](https://github.com/mlightcad/realdwg-web) 的全部包
(`common`、`geometry-engine`、`graphic-interface`、`data-model`、`libredwg-converter`)
已合并进 `cad-viewer/packages/`,统一为单一 pnpm + nx monorepo,
用于大图纸(煤矿采掘工程平面图等)加载与渲染性能的联合优化。

## 项目组成

| 目录 | 说明 |
| --- | --- |
| `cad-viewer/` | 纯浏览器端 DWG/DXF 查看器与编辑器 monorepo(解析、几何处理、渲染全部在浏览器内完成,无后端依赖);其中 `packages/common`、`packages/geometry-engine`、`packages/graphic-interface`、`packages/data-model`、`packages/libredwg-converter` 为原 realdwg-web 的解析核心,仿 AutoCAD ObjectARX 的 API 设计 |
| `data/` | 大图纸测试数据(真实矿图 DXF,含 95MB、38 万实体的 `JKYHMKA01A01yh3m.dxf`) |
| `docs/` | [性能优化总结](./docs/性能优化总结.md)(根因分析、已实施优化、遗留工作) |

## 环境要求

- [Node.js](https://nodejs.org/) >= 24
- [pnpm](https://pnpm.io/) >= 10

## 快速开始

```bash
cd cad-viewer
pnpm install      # 单仓库一次安装;@mlightcad/* 内部依赖均为 workspace 协议
pnpm dev          # 全功能查看器(nx 自动按依赖顺序构建 data-model 等包)
pnpm dev:simple   # 简单查看器
pnpm dev:realdwg  # 解析核心 demo(原 realdwg-web example)
```

合并后不再需要先构建解析层:`dev`/`build` 目标通过 nx 依赖图自动先构建
`common → geometry-engine → graphic-interface → data-model → libredwg-converter`。

## 性能测试

基准与诊断脚本位于 `cad-viewer/tools/bench/`(原 realdwg-web/tools/bench):

```bash
cd cad-viewer
node tools/bench/generate-large-dxf.mjs   # 生成大文件夹具(lines/lwpolylines/circles/mixed/bigcoords 等)
node tools/bench/bench-parse.cjs          # 解析基准(bestMs/avgMs/peakHeapMB/entities,结果存 baseline.json)
node tools/bench/scan-coords.cjs          # DXF 坐标分布扫描(大坐标诊断用)
```

浏览器端渐进式渲染 A/B 基准:`cad-viewer/packages/cad-viewer-example/bench/progressive.html`。

真实大图纸位于 `data/`(煤矿矿图,mxdraw 生成,GBK 编码),其中
`JKYHMKA01A01yh3m.dxf`(95MB、389,328 实体、坐标千万级)是当前优化的目标文件。

## 测试

```bash
cd cad-viewer
pnpm test   # 全量 jest(含 data-model 等原 realdwg-web 包的测试套件)
```

## 文档

- [docs/性能优化总结.md](./docs/性能优化总结.md):本次大图纸优化的背景、根因、已实施改动(M0–M2)、基准数据与遗留工作(M3+)
- [docs/架构图.md](./docs/架构图.md):项目流程图与架构图(工作区结构、DXF/DWG 解析管线、渐进式渲染流程、类结构、基准工具链,Mermaid 绘制)
- [cad-viewer/README.md](./cad-viewer/README.md)(含中/日/韩/西/葡/俄/捷克等多语言版本)
- 解析核心各包的 README 位于 `cad-viewer/packages/{data-model,libredwg-converter,...}/README.md`

## 注意事项

1. 本机为软件渲染环境(无真实 GPU),渲染类优化(如大坐标原点平移)需在真实 GPU 环境验证。

## License

本工作区仅聚合上游项目,不改变其许可证:

- [cad-viewer](./cad-viewer/LICENSE):MIT
- 原 realdwg-web 各包:MIT 为主,其中 `@mlightcad/libredwg-converter` 为 GPL-3.0
  (LibreDWG 解析器需以独立 Web Worker 方式部署以隔离许可证,详见
  [packages/libredwg-converter](./cad-viewer/packages/libredwg-converter/README.md))
