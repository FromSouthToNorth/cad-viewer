# CAD 大图纸性能优化工作区

本仓库是 [mlightcad/cad-viewer](https://github.com/mlightcad/cad-viewer) 与
[mlightcad/realdwg-web](https://github.com/mlightcad/realdwg-web) 的本地联合开发工作区,
将两个项目并列检出、通过 pnpm overrides 本地联动,用于大图纸(煤矿采掘工程平面图等)
加载与渲染性能的联合优化。

## 项目组成

| 目录 | 说明 |
| --- | --- |
| `cad-viewer/` | 纯浏览器端 DWG/DXF 查看器与编辑器 |
| `realdwg-web/` | DWG/DXF 解析核心,仿 ObjectARX API 设计 |
| `data/` | 大图纸测试数据(真实矿图 DXF) |
| `docs/` | [性能优化总结](./docs/性能优化总结.md) |

## 环境要求

- [Node.js](https://nodejs.org/) >= 24
- [pnpm](https://pnpm.io/) >= 10

## 快速开始

```bash
node bootstrap.mjs          # 一键初始化(增量,已完成步骤自动跳过)
cd cad-viewer
pnpm dev                    # 全功能查看器
pnpm dev:simple             # 简单查看器
```

首次初始化较慢(需安装依赖 + 全量构建),后续重跑会自动跳过已完成步骤。
使用 `node bootstrap.mjs --fast` 可跳过最终验证构建,更快进入开发。

## 本地联动(cad-viewer ↔ realdwg-web)

cad-viewer 通过 pnpm `link:` 覆盖直接链接 realdwg-web 源码,**修改 realdwg-web 后只需重新构建对应包并重启 dev server,无需重新 `pnpm install`**。

```bash
# 日常开发:修改 realdwg-web 后重建
cd realdwg-web
pnpm exec nx run-many -t build -p @mlightcad/common @mlightcad/geometry-engine \
  @mlightcad/graphic-interface @mlightcad/data-model

# 切回 npm 源(发布/CI 前)
cd cad-viewer && node tools/use-local-realdwg.mjs --off && pnpm install

# 切回本地联动
cd cad-viewer && node tools/use-local-realdwg.mjs && pnpm install
```

防护机制: cad-viewer 的 `predev`/`prebuild` 会自动检查本地包是否已构建,
未构建时给出修复提示而非晦涩的 TS2307 报错。

> **发布或提交前必须执行 `--off` 还原 overrides 并重新 `pnpm install`。**

## 手动初始化

等价于 `bootstrap.mjs` 的各步,用于排查问题:

```bash
cd realdwg-web && pnpm install
pnpm exec nx run-many -t build -p @mlightcad/common @mlightcad/geometry-engine \
  @mlightcad/graphic-interface @mlightcad/data-model
cd ../cad-viewer
node tools/use-local-realdwg.mjs
pnpm install
pnpm build          # 可选,验证构建
```

## 性能测试

```bash
cd realdwg-web
node tools/bench/generate-large-dxf.mjs   # 生成大文件夹具
node tools/bench/bench-parse.cjs          # 解析基准测试
node tools/bench/scan-coords.cjs          # DXF 坐标分布扫描
```

浏览器端渐进式渲染 A/B 基准: `cad-viewer/packages/cad-viewer-example/bench/progressive.html`。

真实大图纸位于 `data/`(煤矿矿图),其中 `JKYHMKA01A01yh3m.dxf`(95MB、38 万实体)是当前优化目标。

## 测试

```bash
cd realdwg-web && pnpm test                                           # data-model 等(821)
cd ../cad-viewer && pnpm --filter @mlightcad/cad-simple-viewer test   # 简单查看器(358)
```

## 文档

- [docs/性能优化总结.md](./docs/性能优化总结.md): 根因分析、已实施优化(M0–M2)、遗留工作(M3+)
- [docs/架构图.md](./docs/架构图.md): 项目流程图与架构图(Mermaid)
- [docs/高性能技术分析.md](./docs/高性能技术分析.md)
- [cad-viewer/README.md](./cad-viewer/README.md)(含多语言版本)
- [realdwg-web/README.md](./realdwg-web/README.md): 解析核心 API 与许可证说明

## 注意事项

1. 两个子目录是普通目录(随本仓库一起提交),改动直接在本仓库内提交。
2. `cad-viewer/pnpm-workspace.yaml` 的本地 overrides 属于开发期配置,**发布或推送到独立 CI 前必须还原**。
3. 本机为软件渲染环境(无真实 GPU),渲染类优化需在真实 GPU 环境验证。

## License

- [cad-viewer](./cad-viewer/LICENSE): MIT
- [realdwg-web](./realdwg-web/LICENSE): MIT 为主, `@mlightcad/libredwg-converter` 为 GPL-3.0
