# -*- coding: utf-8 -*-
"""分析 DXF 文件实体构成与各阶段耗时, 用于定位 process_dxf.py 性能瓶颈"""
import sys
import time
from collections import Counter
from pathlib import Path

import ezdxf


def main(path_str):
    t0 = time.time()
    doc = ezdxf.readfile(path_str)
    t1 = time.time()
    print(f"加载耗时: {t1 - t0:.1f}s")

    msp = doc.modelspace()
    c = Counter(e.dxftype() for e in msp)
    total = sum(c.values())
    print(f"模型空间实体总数: {total}")
    for t, n in c.most_common(20):
        print(f"  {t:20s} {n}")

    # 块统计
    nblocks = 0
    max_block_entities = 0
    block_entity_total = 0
    for bl in doc.blocks:
        if bl.name.lower().startswith(("*model_space", "*paper_space")):
            continue
        n = len(bl)
        nblocks += 1
        block_entity_total += n
        max_block_entities = max(max_block_entities, n)
    print(f"块定义数: {nblocks}, 块内实体总数: {block_entity_total}, 最大块实体数: {max_block_entities}")

    # INSERT 嵌套深度估计
    inserts = [e for e in msp if e.dxftype() == "INSERT"]
    if inserts:
        names = Counter(e.dxf.name for e in inserts)
        print(f"INSERT 数: {len(inserts)}, 引用块种类: {len(names)}, top5: {names.most_common(5)}")

    # 多段线顶点规模
    npts = 0
    npl = 0
    for e in msp.query("LWPOLYLINE"):
        npl += 1
        npts += len(e)
        if npl >= 200000:
            break
    if npl:
        print(f"LWPOLYLINE 抽样 {npl} 条, 平均顶点数: {npts / npl:.1f}")

    # HATCH 边界规模
    nh = 0
    for e in msp.query("HATCH"):
        nh += 1
        if nh >= 200000:
            break
    print(f"HATCH 数量(抽样上限20万): {nh}")

    # 图层
    off = [l.dxf.name for l in doc.layers if l.is_off() or l.is_frozen() or l.is_locked()]
    print(f"关闭/冻结/锁定图层数: {len(off)}")
    print(f"图层总数: {len(doc.layers)}")

    t2 = time.time()
    print(f"统计耗时: {t2 - t1:.1f}s")


if __name__ == "__main__":
    main(sys.argv[1])
