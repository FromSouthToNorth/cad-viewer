# -*- coding: utf-8 -*-
"""处理后文件体检: 模型空间剩余实体类型/TEXT对齐分布/残留INSERT"""
import collections
import ezdxf

doc = ezdxf.readfile(r"cad/dxf/processed/千树塔井上下对照图（2025.04）.dxf")
msp = doc.modelspace()
types = collections.Counter(e.dxftype() for e in msp)
print("模型空间类型:", dict(types.most_common(15)))

tx = collections.Counter()
for e in msp.query("TEXT"):
    tx[(e.dxf.get("halign", 0), e.dxf.get("valign", 0))] += 1
print("TEXT (halign,valign):", dict(sorted(tx.items())))

ins = list(msp.query("INSERT"))
print(f"残留 INSERT: {len(ins)}")
for e in ins[:10]:
    print(f"  INSERT block={e.dxf.name!r} at ({e.dxf.insert.x:.1f},{e.dxf.insert.y:.1f}) scale={e.dxf.get('xscale',1):.3f}")
