# -*- coding: utf-8 -*-
"""对比新旧去重键的差异: 跑到 dedup 前一刻, 分别用旧键(dxfattribs)和新键(快速键)找重复"""
import sys
sys.path.insert(0, "cad")
import time
import ezdxf
from process_dxf import (collect_bad_layers, explode_tables, explode_blocks,
                         explode_hatches, mtext_to_text, justify_left, unify_fonts,
                         fix_text_height, polylines_to_lines, delete_short_lines,
                         reset_thickness, fast_dedup_key, _norm, Stats)

t0 = time.time()
doc = ezdxf.readfile(sys.argv[1])
msp = doc.modelspace()
stats = Stats()
explode_tables(msp, stats)
explode_blocks(msp, stats)
explode_hatches(doc, msp, stats)
mtext_to_text(doc, msp, stats)
justify_left(msp, stats)
unify_fonts(doc, stats)
fix_text_height(msp, doc, stats)
polylines_to_lines(doc, msp, stats)
delete_short_lines(doc, msp, stats)
reset_thickness(msp, stats)
print(f"流水线耗时: {time.time()-t0:.1f}s, 实体数: {len(msp)}")


def old_key(e):
    if not hasattr(e, "dxfattribs"):
        return None
    try:
        attribs = e.dxfattribs()
        items = []
        for k, v in sorted(attribs.items()):
            if k in ("handle", "owner"):
                continue
            nv = _norm(v)
            try:
                hash(nv)
            except TypeError:
                nv = repr(nv)
            items.append((k, nv))
        return (e.dxftype(), tuple(items))
    except Exception:
        return None


old_seen, old_dups = {}, set()
new_seen, new_dups = {}, set()
for e in msp:
    k = old_key(e)
    if k is not None:
        if k in old_seen:
            old_dups.add(e.dxf.handle)
        else:
            old_seen[k] = e.dxf.handle
    k2 = None
    try:
        k2 = fast_dedup_key(e)
    except Exception:
        pass
    if k2 is None and k is not None:
        k2 = ("FALLBACK", k)
    if k2 is not None:
        if k2 in new_seen:
            new_dups.add(e.dxf.handle)
        else:
            new_seen[k2] = e.dxf.handle

print(f"旧键重复数: {len(old_dups)}, 新键重复数: {len(new_dups)}")
only_new = new_dups - old_dups
only_old = old_dups - new_dups
print(f"仅新键判重: {len(only_new)}, 仅旧键判重: {len(only_old)}")
# 抽样展示仅新键判重的实体及其"首次出现"实体类型
from collections import Counter
print("仅新键判重实体类型:", Counter(doc.entitydb.get(h).dxftype() for h in list(only_new)[:200]))
for h in list(only_new)[:5]:
    e = doc.entitydb.get(h)
    print("  样例:", e.dxftype(), repr(e.dxfattribs())[:300])
