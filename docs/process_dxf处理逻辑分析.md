# process_dxf.py 处理逻辑分析

> 对应文件: `cad-tools/process_dxf.py`

---

## 1. 重复实体删除 — `dedup_entities` (第 558 行)

遍历 modelspace 中每个实体，通过 `e.dxfattribs()` 拿到该实体的**全部 DXF 属性**（坐标、图层、颜色、线型等），排除 `handle` 和 `owner`（这两个是实例标识符，必然不同），然后：

- 对每个属性值做 `_norm` 归一化：浮点数保留 6 位小数，`Vec3` 转为 `(x, y, z)` 元组并同样保留 6 位，嵌套结构递归处理。
- 无法 hash 的值回退到 `repr()` 字符串。
- 最终生成的 key 是 `(实体类型, 排序后的属性键值对元组)`。

用一个 `seen` 集合记录，**key 已经存在就判定为重复并删除**，否则加入集合。本质就是"类型 + 全部显示属性 + 几何数据完全相同 = 重复"。

---

## 2. 无用块清理 — `purge_unused_blocks` (第 401 行)

分两步判断一个块定义是否"无用"：

1. **收集所有被引用的块名**：扫描 `all_spaces(doc)`（模型空间 + 图纸空间 + 所有非布局块定义）中每个实体，把 `INSERT` 的 `dxf.name` 加入引用集合；同时把 `DIMENSION`、`LEADER`、`MULTILEADER`、`ACAD_TABLE` 的存在标记为"需要保留匿名块"。
2. **保护尺寸标注块**：遍历所有 `DIMSTYLE`，把 `dimblk`、`dimblk1`、`dimblk2`、`dimldrblk` 引用的块名也加入保护集合（这些是箭头/引线块，以块名方式被间接引用）。

最后遍历所有块定义，**同时满足以下条件就删除**：
- 不是 `*Model_Space` / `*Paper_Space` 等布局块
- 不在引用集合中
- 如果存在尺寸/表格（`keep_anonymous=True`），保留以 `*` 开头的匿名块

---

## 3. 多行文本转单行 — `mtext_to_text` (第 234 行)

查询所有 `MTEXT` 实体，判断逻辑很简单——**只要是 MTEXT 就转**：

- 调用 `m.plain_text()` 去掉格式码，得到纯文本；再把 `\P`（段落分隔符）替换为换行，换行替换为空格，最终 `strip()`。
- 无论内容是否包含多行，**始终只生成一个 TEXT**（不拆散），保留原图层、颜色、样式、旋转角、字高、插入点，宽度因子固定为 1.0。
- 原文字为空则不生成 TEXT，但仍删除原 MTEXT。

---

## 4. 填充打散 — `explode_hatches` (第 216 行)

查询所有 `HATCH` 实体，对每个填充：

- 调用 `path.from_hatch(hatch)` 把填充的边界路径提取为 ezdxf 的 `Path` 对象。
- 每条路径通过 `flatten_path_to_lines` 离散为直线段：用 `p.flattening(FLATTEN_DIST)`（最大弦高误差 0.05）把曲线（圆弧、样条等）转成折线点，如果是闭合路径且首尾没闭合则补上首点，最后按相邻点生成线段对。过滤掉长度为 0 的重合点。
- 每条直线段以原 HATCH 的图层/颜色等属性 `add_line` 到 modelspace。
- 全部生成完后删除原 HATCH。

**如果 `from_hatch` 抛异常，保留原 HATCH 不删**。

---

## 5. 块打散 — `explode_blocks` (第 173 行)

**递归打散**，最多 32 层（`MAX_EXPLODE_DEPTH`）：

- 每轮查询 modelspace 中所有 `INSERT` 实体。
- 对每个 INSERT 调用 `explode.explode_entity(ins, target_layout=msp)`，ezdxf 会把块定义内的实体展开到目标 layout，原 INSERT 随之销毁。
- 每轮结束后检查：如果剩余 INSERT 数量和本轮开始时一样（一个都没打散成功），说明遇到了打不散的块，打 warn 后退出，防止死循环。
- 打散失败的块保留原样。

---

## 6. 表格打散 — `explode_tables` (第 196 行)

查询所有 `ACAD_TABLE` 实体，对每个表格：

- 先检查是否支持 `virtual_entities` 属性（ezdxf 对 ACAD_TABLE 的展开能力依赖于此）。
- 支持则直接调用 `explode.explode_entity(tbl, target_layout=msp)`，表格内部的内容（本质是匿名块定义中的线段、文字等）被展开到 modelspace。
- 不支持则跳过并打 warn。
- 展开失败的表格保留原样。

---

## 执行顺序要点

主流程 `process_file` 中的执行顺序（第 637-651 行）：

```
表格打散 → 块打散 → 填充打散 → 文本转换 → 多段线打断 → 删除短线段
→ 重复实体删除 → 无用块清理
```

先打散再删除重复，这样打散产生的重复线段也能被清理掉；先清理重复再 purge 无用块，保证打散后不再被引用的块定义能被正确回收。
