# process_dxf.py 详细文档

## 1. 概述

`process_dxf.py` 是一个基于 `ezdxf` 库的 DXF 图纸批量预处理脚本,用于在将 DXF 文件加载到 Web 端 CAD 查看器之前,对图纸进行清洗、简化和标准化处理。

**核心目标**:
- 减小文件体积,提升前端加载性能
- 统一数据格式,简化前端解析逻辑
- 移除无用/不可见内容,避免渲染干扰
- 将复杂实体打散为基础图元(直线、文本),降低解析复杂度

**依赖版本**:ezdxf 1.4+

---

## 2. 处理流程详解

脚本按固定顺序执行 12 个处理阶段,每个阶段有明确的职责和依赖关系。

### 2.1 阶段 0:文件读取

```python
doc = ezdxf.readfile(str(src))
```

- 优先使用标准 `readfile`
- 若失败,回退到 `recover.readfile` 容错模式(适用于轻微损坏的文件)
- 读取失败则跳过该文件,记录错误日志

### 2.2 阶段 1:坏图层实体清理(第 1 遍)

**函数**:`collect_bad_layers` + `delete_entities_on_layers`

**处理逻辑**:
1. 遍历所有图层,收集状态为 `OFF`(关闭)、`FROZEN`(冻结)、`LOCKED`(锁定)的图层名
2. 遍历模型空间 + 图纸空间 + 所有块定义内部,删除位于坏图层上的实体

**目的**:
- 关闭/冻结/锁定的图层在 CAD 中不可见或不可编辑,Web 端无需加载
- 先删除实体,后续再删除图层定义本身

**实现细节**:
- `all_spaces(doc)` 返回所有需要遍历的空间,包括 `doc.layouts`(模型/图纸空间)和 `doc.blocks`(块定义),但跳过 `*model_space` 和 `*paper_space` 避免与布局重复
- 通过 `e.dxf.is_supported("layer")` 检查实体是否支持图层属性

### 2.3 阶段 2:外部参照绑定

**函数**:`bind_xrefs` + `remove_failed_xrefs`

**处理逻辑**:
1. 遍历 `doc.block_records`,识别 `is_xref == True` 的外部参照块
2. 对每个外部参照调用 `ezdxf.xref.embed(bl, search_paths=[...])`,尝试从指定目录加载并嵌入
3. 绑定成功的记录到 `stats.xref`,失败的记录到 `failed` 列表
4. 删除 `failed` 中参照块对应的所有 `INSERT` 实体,并移除块定义

**目的**:
- 外部参照(XREF)是链接到其他 DWG/DXF 文件的块,Web 端无法直接加载
- 绑定后将参照内容嵌入当前文件,后续块打散可展开其内容
- 绑定失败的参照(如文件缺失)需彻底删除,避免前端加载时报错

**实现细节**:
- `search_paths` 使用源文件所在目录 `src.parent`,确保相对路径的参照文件可被找到
- 删除失败参照时,先遍历所有空间删除 `INSERT`,再调用 `doc.blocks.delete_block(name, safe=False)`

### 2.4 阶段 3:表格打散

**函数**:`explode_tables`

**处理逻辑**:
```python
for tbl in list(msp.query("ACAD_TABLE")):
    explode.explode_entity(tbl, target_layout=msp)
```

- 查询所有 `ACAD_TABLE` 实体
- 调用 `explode.explode_entity` 将表格打散为基础图元(文本、直线)
- 表格内容实际存储在匿名块中,打散后会生成对应的 `TEXT` 和 `LINE`

**目的**:
- `ACAD_TABLE` 是 AutoCAD 的高级实体,前端解析复杂
- 打散后变为独立的文本和线段,前端可直接渲染

**兜底逻辑**:
- 检查 `hasattr(tbl, "virtual_entities")`,若不支持则跳过并记录警告

### 2.5 阶段 4:块递归打散

**函数**:`explode_blocks`

**处理逻辑**:
```python
depth = 0
while depth < MAX_EXPLODE_DEPTH:  # MAX_EXPLODE_DEPTH = 32
    inserts = list(msp.query("INSERT"))
    if not inserts:
        break
    for ins in inserts:
        explode.explode_entity(ins, target_layout=msp)
    depth += 1
    # 防死循环检测
    remaining = list(msp.query("INSERT"))
    if remaining and len(remaining) == len(inserts):
        break
```

- 循环打散,每轮处理当前所有 `INSERT` 实体
- `explode.explode_entity` 会将块引用替换为块定义内的实际图元,并应用变换(平移、旋转、缩放)
- 递归处理嵌套块(块内还有块)
- 最多递归 32 层,防止无限嵌套

**目的**:
- 块引用(INSERT)是 CAD 的复用机制,前端需展开为独立图元
- 打散后所有图元都在模型空间,前端无需处理块引用逻辑

**防死循环机制**:
- 若某一轮打散后,`INSERT` 数量未减少,说明有块无法打散(如循环引用或特殊块)
- 主动 break 并记录警告

### 2.6 阶段 5:填充打散

**函数**:`explode_hatches`

**处理逻辑**:
```python
for hatch in list(msp.query("HATCH")):
    for p in path.from_hatch(hatch):
        for a, b in flatten_path_to_lines(p):
            msp.add_line(a, b, dxfattribs=dict(attribs))
    msp.delete_entity(hatch)
```

- `path.from_hatch(hatch)` 提取填充的边界路径(可能是直线、圆弧、样条曲线)
- `flatten_path_to_lines(p)` 将路径离散为直线段:
  - 调用 `p.flattening(FLATTEN_DIST)`,弦高误差 ≤ 0.05
  - 若路径闭合,补回起点保证首尾相接
  - 过滤掉长度 < 1e-6 的退化线段
- 用离散后的直线段重建填充边界,保留原填充的图层、颜色等属性
- 删除原 `HATCH` 实体

**目的**:
- `HATCH` 是填充图案,前端解析复杂(需处理图案填充、边界求交等)
- 打散为边界线后,前端只需渲染线段,视觉效果一致

**实现细节**:
- `flatten_path_to_lines` 对闭合路径会检查首尾点是否已重合,避免重复添加

### 2.7 阶段 6:多行文本转单行文本

**函数**:`mtext_to_text`

**处理逻辑**:
```python
for m in list(msp.query("MTEXT")):
    content = m.plain_text().replace("\\P", "\n").replace("\n", " ").strip()
    attribs = {
        "style": m.dxf.style,
        "rotation": m.dxf.rotation,
        "height": m.dxf.char_height,
        "insert": m.dxf.insert,
        "width": 1.0
    }
    msp.add_text(content, dxfattribs=attribs)
    msp.delete_entity(m)
```

- `m.plain_text()` 提取纯文本,去除格式控制符(如 `\\f...`, `\\C...`)
- 将段落分隔符 `\\P` 和换行符替换为空格,合并为单行
- 创建新的 `TEXT` 实体,保留样式、旋转角、字高、插入点
- 强制设置 `width = 1.0`(宽度因子,后续会统一处理)
- 删除原 `MTEXT`

**目的**:
- `MTEXT` 是富文本,支持多行、格式化,前端解析复杂
- 转为 `TEXT` 后,前端只需处理单行文本

**注意**:
- 数字、长文本不会自动拆散,始终生成一个 `TEXT`
- 若内容为空,不创建新文本

### 2.8 阶段 7:文本左对齐

**函数**:`justify_left`

**处理逻辑**(保持渲染位置不变):
```python
for t in list(msp.query("TEXT")):
    align = t.get_align_enum()
    if align != TextEntityAlignment.LEFT:
        if align not in (ALIGNED, FIT):      # ALIGNED/FIT 的 insert 本就是基线左端
            t.dxf.insert = _left_baseline_point(t, doc)  # 按原对齐方式反算基线左端
        t.set_align_enum(TextEntityAlignment.LEFT)
    t.dxf.align_point = t.dxf.insert         # 关键: 清除残留组码 11
```

- 检查文本对齐方式,若非左对齐则转换
- **不能**直接把组码 11(`align_point`)当插入点:居中/右对齐/正中时该点是文字
  中心或右端,直接赋值会让文字整体平移(居中右移半个字宽)
- `_left_baseline_point` 按原对齐方式(halign/valign)、字高、宽度因子、旋转角,
  用 ezdxf 字体度量(`TextLine.baseline_vertices`)反算基线左端点作为新插入点
- **必须清除残留组码 11**(置为等于组码 10):前端 viewer 在组码 11 有效
  (非零且不等于组码 10)时**优先用它做锚点**;残留旧对齐点会让上一步的
  位置修复完全失效(文字仍锚在旧中心/右端)
- 设置对齐方式为 `LEFT`

**目的**:
- 统一所有文本为左对齐,简化前端渲染逻辑
- 前端只需按 `insert` 点渲染,无需处理多种对齐方式

**实现细节**:
- `align_point` 是 CAD 中用于右对齐、居中对齐等的参考点,非左对齐时组码 10
  通常是无效旧值,渲染器只认组码 11
- 转换后渲染包围盒与原文逐实体一致(有 `cad-tools/tools/test_justify.py` 回归验证,
  并已在 viewer 中实测: 居中/右对齐/正中/旋转/MTEXT 各种文字与原图逐像素一致)
- MTEXT 转 TEXT(阶段 6)同理:MTEXT 插入点是 9 宫格对齐点(默认左上),需按
  对齐点反算首行基线左端点,否则文字会上移一个字高

### 2.9 阶段 8:字体统一

**函数**:`unify_fonts`

**处理逻辑**:
```python
for st in doc.styles:
    st.dxf.font = "simsun.ttf"  # 宋体
    st.dxf.bigfont = ""         # 清空大字体
    w = getattr(st.dxf, "width", 1.0) or 1.0
    h = getattr(st.dxf, "height", 0.0) or 0.0
    if abs(w - 1.0) > EPS and h > 0:
        st.dxf.height = h * w   # 宽度因子折算进固定字高
    if abs(w - 1.0) > EPS:
        st.dxf.width = 1.0      # 宽度因子归 1
```

- 遍历所有文字样式,统一字体为 `simsun.ttf`(宋体)
- 清空 `bigfont`(用于中日韩字符的大字体文件)
- 若样式定义了宽度因子 `width ≠ 1.0` 且固定字高 `height > 0`,将宽度因子折算到高度:`height = height * width`
- 将宽度因子归 1

**目的**:
- 前端无需处理多种字体,统一使用宋体
- 宽度因子归 1 后,文本渲染无需额外缩放

**实现细节**:
- 宽度因子 `width` 控制字符宽度(>1 拉宽,<1 压窄)
- 折算后,字高已包含宽度信息,后续渲染无需再乘宽度因子

### 2.10 阶段 9:字高换算

**函数**:`fix_text_height`

**处理逻辑**:
```python
style_h = {s.dxf.name: (s.dxf.height or 0.0) for s in doc.styles}
for t in list(msp.query("TEXT")):
    w = t.dxf.width or 1.0
    if abs(w - 1.0) <= EPS:
        continue
    h = t.dxf.height
    if not h:  # 高度为 0 时取样式固定高度
        h = style_h.get(t.dxf.style, 0.0)
    if h > 0:
        t.dxf.height = h * w
    t.dxf.width = 1.0
```

- 构建样式名到固定字高的映射 `style_h`
- 遍历所有 `TEXT`,若实体的宽度因子 `width ≠ 1.0`:
  - 取实体的 `height`,若为 0 则取样式的固定字高
  - 计算新高度 `height = height * width`
  - 将宽度因子归 1

**目的**:
- 与样式级处理配合,确保所有文本的宽度因子都归 1
- 字高已包含宽度信息,前端无需额外处理

**实现细节**:
- `TEXT` 实体的 `height` 为 0 时,表示使用样式的固定字高
- 先处理样式级,再处理实体级,确保不遗漏

### 2.11 阶段 10:多段线打断

**函数**:`polylines_to_lines`

**处理逻辑**:
```python
for e in list(msp.query("LWPOLYLINE POLYLINE")):
    attribs = common_attribs(e)
    try:
        p = path.make_path(e)
        segs = flatten_path_to_lines(p)
    except Exception:
        # 退化方案: 直接按顶点连线
        if e.dxftype() == "LWPOLYLINE":
            pts = [Vec3(pt[0], pt[1], 0) for pt in e.get_points("xy")]
            closed = e.closed
        else:
            pts = [v.dxf.location for v in e.vertices]
            closed = e.is_closed
        if closed and pts:
            pts.append(pts[0])
        segs = [(a, b) for a, b in zip(pts, pts[1:]) if not a.isclose(b, abs_tol=EPS)]
    for a, b in segs:
        msp.add_line(a, b, dxfattribs=dict(attribs))
    msp.delete_entity(e)
```

- 查询所有 `LWPOLYLINE`(轻量多段线)和 `POLYLINE`(旧式多段线)
- 优先使用 `path.make_path` 创建路径对象,调用 `flatten_path_to_lines` 离散为直线段(弦高误差 ≤ 0.05)
- 若路径创建失败,退化方案:
  - `LWPOLYLINE`:提取顶点 XY 坐标,构造 `Vec3`
  - `POLYLINE`:提取 `vertices` 的 `location`
  - 若闭合,补回起点
  - 按顶点顺序连线,过滤退化线段
- 用离散后的直线段重建,保留原多段线的图层、颜色等属性
- 删除原多段线

**目的**:
- 多段线包含弧段、凸度等复杂信息,前端解析复杂
- 打散为直线段后,前端只需处理 `LINE` 实体

**实现细节**:
- `flatten_path_to_lines` 会将圆弧、样条曲线离散为直线段,弦高误差控制在 0.05
- 闭合多段线会补回起点,保证首尾相接

### 2.12 阶段 11:删除短线段

**函数**:`delete_short_lines`

**处理逻辑**:
```python
for ln in list(msp.query("LINE")):
    if (ln.dxf.end - ln.dxf.start).magnitude <= MIN_LINE_LEN + EPS:
        msp.delete_entity(ln)
```

- `MIN_LINE_LEN = 0.1`
- 计算线段长度 `(end - start).magnitude`
- 删除长度 ≤ 0.1 的直线段

**目的**:
- 极短线段通常是绘图误差或退化几何,前端渲染无意义
- 删除后减小文件体积,提升渲染性能

**实现细节**:
- 在多段线打断之后执行,确保打散产生的短线段也被清理
- `EPS = 1e-6` 用于浮点比较,避免精度问题

### 2.13 阶段 12:厚度归零

**函数**:`reset_thickness`

**处理逻辑**:
```python
for e in list(msp.query("LINE ARC")):
    if abs(getattr(e.dxf, "thickness", 0.0) or 0.0) > EPS:
        e.dxf.thickness = 0.0
```

- 遍历所有 `LINE` 和 `ARC`
- 将 `thickness`(厚度)属性归 0

**目的**:
- 厚度用于 3D 拉伸效果(2D 实体沿 Z 轴拉伸),Web 端通常只渲染 2D
- 归零后避免前端误处理 3D 信息

### 2.14 阶段 13:重复实体删除

**函数**:`dedup_entities`

**处理逻辑**:
```python
seen = set()
for e in list(msp):
    attribs = e.dxfattribs()
    key_items = []
    for k, v in sorted(attribs.items()):
        if k in ("handle", "owner"):
            continue
        nv = _norm(v)
        try:
            hash(nv)
        except TypeError:
            nv = repr(nv)
        key_items.append((k, nv))
    key = (e.dxftype(), tuple(key_items))
    if key in seen:
        msp.delete_entity(e)
    else:
        seen.add(key)
```

- 遍历模型空间所有实体
- 提取实体的所有 DXF 属性(`dxfattribs()`),忽略 `handle` 和 `owner`(唯一标识符,不影响显示)
- 对属性值进行归一化 `_norm`:
  - `float` 保留 6 位小数
  - `Vec3` 转为 `(x, y, z)` 元组,各分量保留 6 位
  - 嵌套结构递归处理
- 构造去重键 `(实体类型, 排序后的属性元组)`
- 若键已存在,删除实体

**目的**:
- 删除完全重复的实体(相同类型、相同属性、相同坐标)
- 减小文件体积,避免前端重复渲染

**实现细节**:
- `_norm` 函数处理浮点精度问题,保留 6 位小数
- 对无法 hash 的值(如复杂对象),使用 `repr` 转为字符串
- `ok = True` 但从未被置 False,是遗留的废逻辑

### 2.15 阶段 14:坏图层实体清理(第 2 遍)

**函数**:`delete_entities_on_layers`

- 与阶段 1 相同逻辑,再次删除坏图层上的实体
- **目的**:块打散后,可能有新实体落到坏图层上(块定义内的实体原本属于坏图层)

### 2.16 阶段 15:图层清理

**函数**:`remove_bad_layers` + `purge_empty_layers`

**处理逻辑**:
1. `remove_bad_layers`:删除所有关闭/冻结/锁定图层
2. `purge_empty_layers`:遍历所有布局 + 块定义,统计被实体引用的图层;删除未被引用的图层(保留 `0` 和 `Defpoints`)

**目的**:
- 移除无用图层定义,减小文件体积
- 保留 `0` 和 `Defpoints`(AutoCAD 默认图层,即使为空也不删)

### 2.17 阶段 16:无用块清理

**函数**:`purge_unused_blocks`

**处理逻辑**:
```python
referenced = set()
keep_anonymous = False
for sp in all_spaces(doc):
    for e in sp:
        t = e.dxftype()
        if t == "INSERT":
            referenced.add(e.dxf.name)
        elif t in ("DIMENSION", "LEADER", "MULTILEADER", "ACAD_TABLE"):
            keep_anonymous = True
for bl in list(doc.blocks):
    name = bl.name
    if name.lower().startswith(("*model_space", "*paper_space")):
        continue
    if name in referenced:
        continue
    if keep_anonymous and name.startswith("*"):
        continue  # 尺寸/表格仍在使用的匿名块
    doc.blocks.delete_block(name, safe=False)
```

- 统计所有 `INSERT` 引用的块名
- 若存在 `DIMENSION` / `LEADER` / `MULTILEADER` / `ACAD_TABLE`,标记 `keep_anonymous = True`
- 遍历所有块定义,删除未被引用的块(跳过 `*model_space` / `*paper_space`)
- 若 `keep_anonymous` 为真,保留匿名块(以 `*` 开头,如 `*D1`,用于尺寸标注)

**目的**:
- 删除无用块定义,减小文件体积
- 保留尺寸标注等使用的匿名块

### 2.18 阶段 17:数据库回收

**函数**:`purge_entitydb`

**处理逻辑**:
```python
doc.entitydb.purge()
```

- 物理删除已标记为删除的实体,回收数据库空间

**目的**:
- 前面阶段删除的实体只是逻辑删除(标记),文件体积未减小
- `purge()` 后物理删除,显著减小输出文件体积

### 2.19 阶段 18:保存文件

```python
out_dir.mkdir(parents=True, exist_ok=True)
out = out_dir / src.name
doc.saveas(str(out))
```

- 创建输出目录(若不存在)
- 保存处理后的 DXF 到输出目录,文件名不变

---

## 3. 核心函数说明

### 3.1 `common_attribs(e)`

**作用**:提取实体的通用显示属性

**返回**:字典,包含 `layer`, `color`, `linetype`, `lineweight`, `ltscale`, `true_color`(若存在)

**用途**:打散实体时,保留原实体的显示属性

### 3.2 `all_spaces(doc)`

**作用**:返回所有需要遍历的空间

**返回**:列表,包含 `doc.layouts`(模型/图纸空间)和 `doc.blocks`(块定义,跳过 `*model_space` / `*paper_space`)

**用途**:确保块定义内部的实体也被处理

### 3.3 `flatten_path_to_lines(p)`

**作用**:将路径离散为直线段

**参数**:`p` 为 `ezdxf.path.Path` 对象

**返回**:直线段列表 `[(start, end), ...]`

**实现**:
- 调用 `p.flattening(FLATTEN_DIST)` 离散,弦高误差 ≤ 0.05
- 若路径闭合,补回起点
- 过滤退化线段(长度 < 1e-6)

### 3.4 `_norm(v)`

**作用**:归一化属性值,用于去重

**处理**:
- `float` → 保留 6 位小数
- `Vec3` → `(x, y, z)` 元组,各分量保留 6 位
- 嵌套结构递归处理

**用途**:构造去重键,处理浮点精度问题

---

## 4. 命令行用法

```bash
python cad-tools/process_dxf.py [--src cad/dxf] [--out cad/dxf/processed] [--only 部分文件名]
```

**参数**:
- `--src`:源 DXF 文件目录,默认 `cad/dxf`
- `--out`:输出目录,默认 `cad/dxf/processed`
- `--only`:只处理文件名包含该字符串的图纸(可选)

**示例**:
```bash
# 处理所有 DXF
python process_dxf.py

# 指定输入输出目录
python cad-tools/process_dxf.py --src input/dxf --out output/dxf

# 只处理文件名包含 "floor" 的图纸
python cad-tools/process_dxf.py --only floor
```

**输出**:
- 处理日志:每个文件的处理进度、统计信息、警告
- 处理后的 DXF 文件保存到输出目录

---

## 5. 统计信息

脚本通过 `Stats` 类记录每个处理阶段的统计数据:

```python
class Stats:
    xref = 0              # 外部参照绑定数
    blocks = 0            # 块打散数
    tables = 0            # 表格打散数
    hatches = 0           # 填充打散数
    mtext = 0             # 多行文本转换数
    justified = 0         # 文本左对齐数
    fonts = 0             # 字体样式统一数
    heights = 0           # 字高换算数
    polylines = 0         # 多段线打断数
    short_lines = 0       # 删除短线段数
    thickness = 0         # 厚度归零数
    dup_removed = 0       # 重复实体删除数
    empty_layers = 0      # 空图层删除数
    xref_removed = 0      # 无法引用的参照块删除数
    layer_entities = 0    # 坏图层实体删除数
    bad_layers = 0        # 坏图层移除数
    blocks_purged = 0     # 无用块清理数
    warnings = []         # 警告信息列表
```

处理完成后,通过 `stats.dump()` 输出统计摘要。

---

## 6. 关键参数

```python
FONT_TTF = "simsun.ttf"          # 统一字体: 宋体
FLATTEN_DIST = 0.05              # 曲线离散弦高误差
MIN_LINE_LEN = 0.1               # 删除短线段阈值
EPS = 1e-6                       # 浮点比较容差
MAX_EXPLODE_DEPTH = 32           # 块递归打散最大层数
```

**调整建议**:
- `FLATTEN_DIST`:值越小,曲线离散越精细,但线段数增加;推荐范围 0.01 ~ 0.1
- `MIN_LINE_LEN`:值越小,保留的线段越多;推荐范围 0.01 ~ 0.5
- `MAX_EXPLODE_DEPTH`:通常 32 层足够,特殊图纸可增加

---

## 7. 注意事项与限制

### 7.1 已知限制

1. **不支持 DWG**:只能处理 DXF,需先用其他工具(如 ODA File Converter)转为 DXF
2. **不处理 3D 实体**:如 `3DSOLID`,只透传不解释
3. **不执行 AutoLISP**:纯数据清洗,不执行图纸内的脚本
4. **MTEXT 不拆散**:多行文本转为单行时,不会按段落拆散为多个 TEXT

### 7.2 已知问题

1. **`dedup_entities` 废逻辑**:
   ```python
   ok = True
   # ...
   if not ok:  # 永远不会执行
       continue
   ```
   `ok` 从未被置 False,不影响结果但可清理

2. **块打散失败兜底**:
   - 若块无法打散(如循环引用),保留原 `INSERT`
   - 前端需处理未打散的块引用

3. **外部参照绑定失败**:
   - 若参照文件缺失,删除参照及其 INSERT
   - 图纸中可能出现空洞(原参照位置无内容)

### 7.3 性能建议

1. **大文件处理**:
   - 单文件处理时间约几秒到几分钟,取决于实体数量(实测 256MB / 25 万实体图纸约 3 分钟)
   - 批量处理时,可多线程(需注意 ezdxf 非线程安全,建议进程池)

2. **内存占用**:
   - ezdxf 将整个文档加载到内存,大文件(>100MB)可能占用数 GB
   - 建议预处理时限制单文件大小

3. **磁盘 I/O**:
   - `purge_entitydb()` 显著减小输出文件体积
   - 输出目录建议与源目录分离,避免覆盖

### 7.4 性能优化要点(大文件必读)

针对数百万级实体的图纸,以下设计决定了脚本能否在可接受时间内完成:

1. **禁止在循环中调用 `layout.delete_entity`**:
   - ezdxf 的实体空间底层是 Python `list`,`delete_entity` 内部走 `list.remove`,单次 O(n)
   - 循环删除 N 个实体整体退化为 O(n²),百万级实体时是不可用的(数天量级)
   - 正确做法:`batch_delete(doc, sp, entities)` —— 先 `doc.entitydb.delete_entity(e)` 逐个销毁(O(1)),
     最后 `sp.entity_space.purge()` 一次性重建列表(O(n))

2. **去重键避免 `e.dxfattribs()`**:
   - `dxfattribs()` 会导出实体全部 DXF 属性,每个实体开销在毫秒级,百万实体需数小时
   - `fast_dedup_key()` 为 LINE/TEXT/ARC/CIRCLE/POINT 等高频类型构造类型相关快速键,
     仅对罕见类型回退到完整属性导出
   - 语义差异:显式存储的默认属性(如 thickness=0)与未存储视为相同,判重更彻底,不影响渲染结果

3. **直线快速路径**:
   - HATCH 边界全为直线时(`PolylinePath` 无凸度 / `EdgePath` 全为 `LineEdge`)直接生成 LINE,
     跳过 `path.from_hatch` + `flattening` 的曲线离散流程
   - LWPOLYLINE 无凸度、POLYLINE 无凸度且无曲线/样条拟合时,直接按顶点连线,跳过 `path.make_path`
   - 矿山图纸实测 100% 命中快速路径

4. **块打散循环**:
   - 每轮只做一次 `msp.query("INSERT")` 全扫描,打散失败的句柄记入 `failed` 集合不再重试

5. **阶段耗时打印**:
   - 每个阶段打印耗时与模型空间实体数,大文件处理时可实时观察进度、定位瓶颈

---

## 8. 与 Web 端集成

### 8.1 处理后的 DXF 特点

1. **实体类型简化**:
   - 仅保留 `LINE`, `ARC`, `CIRCLE`, `TEXT`, `POINT` 等基础图元
   - 无 `INSERT`, `HATCH`, `MTEXT`, `LWPOLYLINE`, `ACAD_TABLE`

2. **属性标准化**:
   - 字体统一为宋体,宽度因子归 1
   - 所有文本左对齐
   - 厚度归 0

3. **图层简化**:
   - 仅保留可见、未锁定的图层
   - 无空图层

4. **体积减小**:
   - 删除重复实体、无用块、坏图层
   - 物理回收数据库

### 8.2 前端解析建议

1. **简化解析逻辑**:
   - 无需处理块引用、多段线凸度、填充边界
   - 直接按实体类型渲染

2. **字体渲染**:
   - 统一使用宋体,前端可预加载字体文件

3. **文本渲染**:
   - 所有文本左对齐,按 `insert` 点渲染
   - 无需处理多种对齐方式

4. **图层管理**:
   - 图层均为可见、未锁定,可直接渲染
   - 前端可提供图层开关功能

---

## 9. 扩展与定制

### 9.1 添加新的处理阶段

在 `process_file` 中按顺序插入新阶段:

```python
def new_stage(msp, stats):
    for e in list(msp.query("SOME_ENTITY")):
        # 处理逻辑
        pass

def process_file(src: Path, out_dir: Path):
    # ...
    new_stage(msp, stats)  # 插入新阶段
    # ...
```

### 9.2 修改参数

直接修改脚本顶部的常量:

```python
FLATTEN_DIST = 0.01  # 更精细的曲线离散
MIN_LINE_LEN = 0.05  # 保留更短的线段
```

### 9.3 添加统计项

在 `Stats` 类中添加字段:

```python
class Stats:
    # ...
    my_counter = 0
```

在处理函数中更新:

```python
stats.my_counter += 1
```

在 `stats.dump()` 中输出:

```python
print(f"    我的统计: {self.my_counter}")
```

---

## 10. 故障排查

### 10.1 读取失败

**现象**:`常规读取失败, 已使用 recover 模式读取`

**原因**:DXF 文件轻微损坏

**处理**:recover 模式会尝试修复,若仍失败则跳过该文件

### 10.2 外部参照绑定失败

**现象**:`外部参照 XXX 绑定失败(文件缺失?)`

**原因**:参照文件不存在于源文件目录

**处理**:
- 检查参照文件路径
- 将参照文件复制到源目录
- 或接受参照被删除的结果

### 10.3 块打散失败

**现象**:`块 XXX 打散失败, 保留原样`

**原因**:块定义复杂或存在循环引用

**处理**:
- 前端需处理未打散的 `INSERT`
- 或在 CAD 中手动打散后重新导出 DXF

### 10.4 填充打散失败

**现象**:`填充打散失败, 保留原样`

**原因**:填充边界复杂或无效

**处理**:
- 前端需处理 `HATCH` 实体
- 或在 CAD 中删除填充后重新导出

---

## 11. 总结

`process_dxf.py` 是一个完整的 DXF 预处理流水线,通过 18 个阶段的处理,将复杂的 CAD 图纸简化为前端易于解析和渲染的基础图元。

**核心价值**:
- 减小文件体积,提升加载性能
- 统一数据格式,简化前端逻辑
- 移除无用内容,避免渲染干扰

**适用场景**:
- Web CAD 查看器的图纸预处理
- DXF 文件批量清洗
- 图纸数据标准化

**后续优化方向**:
- 清理 `dedup_entities` 废逻辑
- 添加更多实体类型的打散支持(如 `SPLINE`, `ELLIPSE`)
- 支持多线程/进程池批量处理
- 添加 GUI 界面,方便非技术用户使用
