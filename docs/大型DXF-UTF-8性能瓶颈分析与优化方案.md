# 大型 UTF-8 DXF 性能瓶颈分析与优化方案

> 分析对象：`cad-viewer/` 渲染链路 + `realdwg-web/packages/data-model/` DXF 解析链路
> 基准代码：`main`（`329561a`）
> 文档日期：2026-08-20

## 结论先行

纯文本扫描/UTF-8 解码已经不是主要瓶颈；当前大头在 **实体对象图构建（data-model 的 ObjectARX 风格对象模型）** 和 **渲染转换时“构建临时几何 → 复制进批次 → 再销毁”的二次搬运**。已有 M1 零分配读取优化让 pair reader 只占约 15–20% 解析耗时。

---

## 1. 实测基线（本机，Node 24，UTF-8 DXF）

| 夹具 | 文件大小 | 实体数 | 全量解析 | Pair 扫描 | 峰值堆 |
|---|---:|---:|---:|---:|---:|
| lines-200000 | 14.2 MB | 200,000 | **771 ms** | 133 ms | **472.8 MB** |
| lines-500000 | 35.6 MB | 500,000 | **1.95 s** | — | 609 MB |
| mixed-100000 | 8.7 MB | 100,000 | 440 ms | — | 257 MB |
| lwpolylines-50000 | 12.8 MB | 50,000 | 261 ms | — | 145 MB |

内存估算器对 20 万 LINE 的结果：约 **2,400,293 个 JS 对象 / 758 MB 估算占用**，其中每个实体约 11 个对象；20 万个空 `_xDataMap` 就估了 16 MB。

V8 采样同时显示：

- `--prof` 中约 **56% 采样落在内部 hash-table 插入路径**，bottom-up 主要回溯到 `commitObjectHandle` / handle registry；
- `.cpuprofile` 热函数为 `atEndOfObject`（约 6%）、`getObjectById`、`parseAsciiValue`、`isTemp`、`AcCmObject.set`；
- GC 约占 **15.5%**，说明小对象分配压力很大。

---

## 2. 解析侧瓶颈（realdwg-web/packages/data-model）

### P1：每实体 append / handle commit 太重（最大头）

`AcDbBlockTableRecord.appendEntity` 对每个实体依次执行：

- `ensureEntityStyleDefaults`
- `commitObjectHandle(item, id => this.hasEntityId(id))`
- `resolveEffectiveProperties`

见 `database/AcDbBlockTableRecord.ts:411-427`。

`commitObjectHandle` 内部又做：

1. `hasId()` → `getIdAt()` → `getObjectById()` 一次 Map 查询；
2. 再次 `_handleRegistry.get(objectId)` 查 incumbent；
3. `assignGeneratedHandle()` 时通过 `object.objectId = handle` 走完整属性系统。

见 `database/AcDbDatabase.ts:1203-1235`。也就是说每个实体至少 2–3 次 Map 探测 + 1 次 maxHandle 解析 + 属性事件路径。

`AcCmObject.set` 更严重：每次设置 `objectId` / `ownerId` 都会：

- `clone(this.attributes)` 复制属性对象；
- `isEqual` 比较；
- 空事件管理器 dispatch；
- 再触发 modelChanged 逻辑。

见 `common/src/AcCmObject.ts:147-210`。大图解析中每个实体至少发生 2–3 次 `set`，这是 profile 中 hash 插入和 GC 的主要来源之一。

### P2：`dxfIn` 热循环反复 peek 同一对 pair

全仓有 **71 处**：

```ts
while (!filer.atEndOfObject && !filer.atEof && !filer.atExtendedData) { ... }
```

每个条件 getter 都调 `peekPair()`。虽然 reader 有 lookahead 缓存，但每读取一个 pair 仍要执行 3 个 getter + 多次判断。典型如：

- `base/AcDbObject.ts:838`
- `entity/AcDbEntity.ts:437`
- `entity/AcDbLine.ts:484`
- `entity/AcDbPolyline.ts:812`

`atEndOfObject` 是 profile 中 JS 侧第一热函数。

### P3：临时 UID + 默认几何被创建后立刻丢弃

`AcDbObject` 构造函数对每个实体都生成 `TEMP_${uid()}`，之后 `dxfIn` 读到组码 5 再覆盖：

- `base/AcDbObject.ts:104` 每个实体创建空 `_xDataMap`
- `base/AcDbObject.ts:115` 生成临时 UID

实体工厂还先创建默认几何，再在 `dxfInFields` 里替换/重建：

```ts
new AcDbLine(new AcGePoint3d(), new AcGePoint3d())
new AcDbCircle(new AcGePoint3d(), 1)
// SPLINE 还会先构造 4 个控制点
```

见 `dxf/AcDbDxfEntityFactory.ts:43-97`。LINE 的 `dxfInFields` 再分配 normal、OCS 变换后的新点（`entity/AcDbLine.ts:469-535`），前面的默认点全部浪费。

### P4：数值行仍先 slice 出字符串再 `Number()`

当前 code 行已经零分配扫描，但 value 行仍是：

```ts
const valueRaw = readLine()          // text.slice(...)
const n = Number(valueRaw)
```

见 `base/AcDbDxfPairReader.ts:273/403/206-240`。大图 90% 以上的 value 是坐标/整数，这些字符串生命周期极短，却贡献了主要小字符串分配和 GC。

### P5：重复短字符串未驻留（interning）

20 万 LINE 的 `layer = "0"` 被 slice 成 20 万个字符串对象保存；层名、线型名、文字样式名在大图里高度重复。没有按 code 6/8/7 等做字符串驻留。

### P6：低危但可顺手改：无效 async await

`DocumentReader.yieldAndReportProgress` 每 200 个实体 `await` 一次，即使没有 progress 回调；`reportParseProgress` 是 `async`，无回调也返回 Promise。对 389k 实体约 2,000 次，开销不大，但可消除。

---

## 3. 渲染侧瓶颈（cad-viewer）

### R1：`batchConvert` 对每个实体无条件 `await maybeYield`

`cad-simple-viewer/src/view/AcTrView2d.ts:2819`：

```ts
const didYield = await yieldGate.maybeYield(yieldToEventLoop)
```

`maybeYield` 是 async 方法，即使预算未到、不真正 yield，也会返回一个已 resolve 的 Promise，`await` 强制每个实体至少一次微任务边界。389k 实体就是 389k 次额外异步调度，对转换吞吐有明显影响。

### R2：Direct 快路径仍是“建一份 → 拷进批次 → dispose”

`tryBuildDirectEntityMetas` 会构建独立 `BufferGeometry`（`view/AcTrDirectBatch.ts:32-67`），然后 `addDirectEntity` 在 `AcTrBatchedLine.addGeometry` 中：

- rebase
- `computeSegmentLineDistances`
- 分配槽位
- 再把所有属性/索引复制进批缓冲

随后 `AcTrView2d.ts:2678-2680` 把临时 geometry dispose。等于每条 LINE/ARC 的几何都在 JS 堆里完整创建、完整复制一次再释放。这是大图转换 CPU 和 GC 的最大头之一。

### R3：批次 origin 选择是线性扫描

`AcTrBatchedGroup.resolveOriginBatch` 对同材质下的所有 origin batch 逐个比较：

见 `three-renderer/src/batch/AcTrBatchedGroup.ts:1920-1958`。

同一图层 + 大坐标分散实体（目标矿图单实体跨度 39M）会产生大量 origin 分桶；最坏情况下每实体 O(已有批次数)，整体接近 O(N²)。该函数同时是“每实体都调用”的热路径。

### R4：`worldDraw` 每实体重复解析图层颜色/线型

每个实体转换时都执行 `entity.worldDraw`，其中：

- `database.isLayerDrawable(this.layer)` 查图层表
- `resolvedColor` 对 ByLayer 再查图层颜色
- `lineStyle` 查线型表并构造 `AcGiLineStyle` 对象

见 `data-model/src/entity/AcDbEntity.ts:769-802`、`898-930`。大图中相邻实体通常属于同一图层，这些结果完全可以按 layer 缓存复用。

### R5：无剔除、固定细分

- 所有批次容器 `frustumCulled = false`：`batch/AcTrBatchedLine.ts:99-102`，同 Mesh/Point/Line2。
- 圆/椭圆/样条每次固定 `getPoints(100)`：`three-renderer/src/renderer/AcTrRenderer.ts:510-521`。缩放很小时仍生成 100 段，几何量与 draw call 无法随视图 LOD 下降。

### R6：渐进打开期间反复全量重算 layout box

`AcTrLayout.addDirectEntity` 每次都 `invalidateBox()`（`view/AcTrLayout.ts:437`），而渐进 fit 每 500ms 调 `resolveLayoutFitBox()`，触发 `recomputeBox()` 扫描所有 layer/batch/slot：

- `view/AcTrLayout.ts:186-193`
- `view/AcTrProgressiveOpenFitController.ts:137-151`

大图打开时相当于每隔 500ms 做一次全量 bounds 扫描。

### R7：渲染映射元数据也偏胖

- `_entitiesMap: Map<string, AcTrEntityInBatchedObject[]>`：绝大多数实体只有一个 slot，却都分配数组（`batch/AcTrBatchedGroup.ts:280`）。
- `AcTrLayout._entityLayerIndex: Map<id, AcTrLayer[]>`：同样每个实体一个数组（`view/AcTrLayout.ts:118`）。
- 38 万实体下，这两层映射的 Map node + 数组对象数量很可观。

---

## 4. 优化方案（按优先级）

### P0-1：data-model 增加“批量导入快路径”

目标：把 append/handle/属性系统的通用能力从导入热路径中剥离。

1. **增加 raw/silent 属性写入**
   - `AcDbObject.setAttrRaw(key, val)` 直接写 `_attrs.attributes[key] = val`，绕开 `AcCmObject.set` 的 clone、isEqual、事件 dispatch。
   - `dxfIn` 中组码 5/330/360 全部改用 raw setter。

2. **批量 append**
   - `appendEntity(entity, { bulkImport: true })`：
     - 跳过 transactionManager 检查；
     - 跳过 `ensureEntityStyleDefaults`（仅 MLINE/MULTILEADER/HATCH 需要，可在 section 结束后统一补一次）；
     - 跳过 `resolveEffectiveProperties()`（相关 getter 本身已有惰性 fallback，留到首次 draw 解析即可）；
     - handle 去重直接 `_handleRegistry.set`，不再每实体执行 `hasId → getIdAt → getObjectById`；
     - maxHandle 只在 section/文件结束时批量更新。

3. **实体工厂导入专用构造**
   - 增加 `AcDbObject` 构造选项，跳过 `TEMP_${uid()}`；
   - `_xDataMap` 改为懒创建；
   - LINE/CIRCLE/ARC/LWPOLYLINE 提供 `createForDxfIn`，先解析字段再一次性构造实际几何；常用 `z=0, normal=(0,0,1)` 时直接赋点，不创建 OCS 变换中间点。

预期：这组改动应能消掉 profile 中 `commitObjectHandle` / `AcCmObject.set` / `isTemp` / 大量 GC 采样，估计解析 CPU 下降 **30–50%**，峰值堆下降 **20–35%**。

### P0-2：渲染转换消除“二次搬运”

1. 先计算实体 WCS bbox / `worldOffset`，再 `resolveOriginBatch` 选出目标批；
2. 针对 LINE/LWPOLYLINE/CIRCLE/ARC 等 `directBatchPrimitive='lineStrip'` 的实体，新增 `appendLineStrip(points, material, worldOffset, objectId)`：
   - 直接以目标 batch origin 为基准，一次性生成 `Float32Array`；
   - 在 `AcTrBatchedLine` 内提供 `appendRawSlot`，把数组直接写入批缓冲；
   - 不再创建临时 `BufferGeometry`、不再 `copyGeometryAttributes`、不再 `dispose()`。
3. 仅复杂实体保留现有 `build → add → dispose` 回退路径。

预期：转换阶段 CPU 和 GC 明显下降，尤其是几十万条 LINE/POLYLINE 的大图。

### P0-3：渲染与解析的同步 yield 判断

给 `AcCmUiYieldGate` 增加同步 `shouldYield()`：

```ts
if (yieldGate?.shouldYield()) {
  await yieldGate.maybeYield(...)
}
```

- `AcTrView2d.batchConvert` 每实体不再强制 microtask；
- `AcDbDxfDocumentReader` / `AcDbNativeDxfConverter` 的 `reportParseProgress` 改为“无 progress 回调时同步返回”，只在真正需要发进度时 `await`。

### P1-1：pair reader 与 dxfIn 循环二次降分配

- 新增 `acdbReadDoubleFromChars` / `acdbReadIntFromChars`，对 code 10–59、140–149、210–239、1010–1059 等数值码直接由 window 字符解析，跳过 `text.slice()`；
- 999 注释行只跳 span，不 slice；
- 为 filer 增加 `readItemToObjectBoundary()` / `peekItemOnce`，把 71 处三 getter 循环改为“一次 read，遇 code 0 / 100 / 1001 时 pushBack 退出”的单一 peek 模式；
- 全仓 `Number(item.code)` / `Number(item.value)` 改为按 `pair.type` 直接读取。

这类改动预计在 pair 扫描（当前 133ms）上还能降 20–40%，并进一步减少 GC。

### P1-2：高频字符串驻留

在 `AcDbDxfDocumentReader` 或 filer 中加一个 per-parse 字符串表，对 code 6/8/7 等高频短字符串做 `Map.get ?? Map.set` 驻留；handle 不驻留。20 万实体只有少量 layer/linetype/style 名称时，可显著降低实体图中的重复字符串内存。

### P1-3：渲染 layer traits 缓存

在转换循环中使用一个 `Map<layerName, ResolvedTraits>`，缓存：

- 图层是否可绘制；
- ByLayer 颜色/线型/线宽/透明度；
- 对应 material key。

仅在 layer table 变化时失效。这样 38 万实体的 `worldDraw` 中绝大部分不再逐实体查表、构造 style 对象。

### P1-4：origin batch 用空间哈希代替线性扫描

以 `floor(worldOffset / RTE_REBASE_THRESHOLD)` 作为 3D cell key：

```ts
Map<materialId, Map<cellKey, AcTrBatchedLine[]>>
```

查找只检查当前 cell（必要时相邻 cell）中的 1–3 个 batch，把 `resolveOriginBatch` 从 O(批次数) 降到 O(1)。保留原逻辑作为 fallback，不影响精度语义。

### P1-5：LOD 与剔除

- `circularArc` / `ellipticalArc` / spline 初始转换按实体屏幕尺寸决定分段数（如 12–64），不再恒为 100；缩放变化后由 idle 任务重建 LOD 或使用 `THREE.LOD`；
- 转换完成后批量调用 `computeBoundingSphere()`，对基础 Line/Mesh/Point batch 打开 `frustumCulled = true`；
- 第二阶段再做 slot 级 culling：每帧/每 N 帧用已缓存的 slot box 更新 draw range，只提交可见 slot。

### P1-6：渐进 bounds 增量维护

`AcTrLayout` 维护一个增量 union box：

- `addDirectEntity` 直接 `union(meta.wcsBbox)`，无需 `invalidateBox`；
- `remove/setVisible` 才置 dirty；
- `recomputeBox()` 仅用于需要 `exclude/include` 语义的查询。

渐进 fit 每 500ms 的 `resolveLayoutFitBox` 从全量扫描变成 O(1) 读缓存。

### P2：更大重构（中期）

1. **渲染映射扁平化**
   - `_entitiesMap` 拆成单 slot 映射（`Map<string, Item>`）+ 多 slot 映射，避免每实体一个数组；
   - `_entityLayerIndex` 同样处理。

2. **DXF 解析移入 Worker**
   - 对 UTF-8 文件可以把 pair 扫描/实体解析放进 Worker；但完整 `AcDbDatabase` 结构化克隆回主线程会很贵。更现实的是 worker 输出紧凑 scene-ready 记录或分块 transfer 的 typed arrays，主线程只做数据库提交与批次合并。建议先完成 P0/P1，再用 95MB 级文件做 A/B 决定是否上 worker。

3. **解析与渲染进一步重叠**
   - 目前 `beginEventBatch()` 会等 PARSE 全部结束才 flush。TABLES 完成后（图层/线型/样式已就绪），可以在 ENTITIES 解析期间就按 chunk 派发 `entityAppended`，让第一批线画得更早。需处理块参照/ATTDEF 顺序与 XDATA 依赖。

---

## 5. 建议实施顺序与验证

| 阶段 | 内容 | 验证 |
|---|---|---|
| P0-1 | 导入快路径、raw setter、工厂免默认几何 | `bench-parse.cjs` lines/mixed/lwpolylines + `AcDbMemoryEstimator` |
| P0-2 | direct-to-batch 直写 | `progressive.html` A/B：`renderCalls`、转换总时长、最大帧间隔 |
| P0-3 | 同步 yield 判断 | 同上，观察 `yieldCount` 不减少、CPU 转换时间下降 |
| P1 | 数值直解析、字符串驻留、traits 缓存、origin hash | 全量 data-model 测试 + OPENPROF 分段耗时 |
| P1-5/6 | LOD/剔除/增量 box | `verify-origin-shift.cjs`、真实 GPU 滚动缩放 |
| P2 | Worker / 扁平映射 | 95MB 目标文件回归，记录首屏、总耗时、峰值内存 |

每个阶段都用现有工具链做回归：`realdwg-web` 821 测试、`cad-simple-viewer` 358 测试，以及 `realdwg-web/tools/bench/baseline.json` 前后对比。

**最关键的两刀**：解析侧把通用对象模型的 set/clone/event 从导入路径摘出去；渲染侧把“临时几何 → 复制 → dispose”改为直接写入批次。这两项完成后，当前 UTF-8 大图的剩余瓶颈才会回到真正难啃的部分——文字排版、块模板与 GPU 提交。
