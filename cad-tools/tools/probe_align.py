# -*- coding: utf-8 -*-
"""统计 MTEXT attachment_point 分布 与 TEXT halign/valign 分布"""
import collections
import ezdxf

PATH = r"cad/dxf/千树塔井上下对照图（2025.04）.dxf"
doc = ezdxf.readfile(PATH)

mt = collections.Counter()
tx = collections.Counter()
spaces = [doc.modelspace()] + list(doc.blocks)
for sp in spaces:
    for e in sp.query("MTEXT"):
        mt[e.dxf.get("attachment_point", 1)] += 1
    for e in sp.query("TEXT"):
        tx[(e.dxf.get("halign", 0), e.dxf.get("valign", 0))] += 1

print("MTEXT attachment_point(1-9: 左上/上中/右上/左中/正中/右中/左下/下中/右下):", dict(sorted(mt.items())))
print("TEXT (halign,valign) h:0左1中2右3对齐4正中5适应 v:0基线1底2中3顶:", dict(sorted(tx.items())))
