# -*- coding: utf-8 -*-
"""探查指定文字内容在原始 DXF 中的实体类型与对齐方式"""
import sys
import ezdxf

PATH = r"cad/dxf/千树塔井上下对照图（2025.04）.dxf"
KEYS = ["防火门", "调节风门", "挡风", "栅栏", "防爆", "风门"]

doc = ezdxf.readfile(PATH)

count = 0
spaces = [("MODEL", doc.modelspace())] + [(f"BLOCK:{b.name}", b) for b in doc.blocks]
for sname, sp in spaces:
    for e in sp.query("TEXT MTEXT"):
        try:
            content = e.dxf.text if e.dxftype() == "TEXT" else e.plain_text()
        except Exception:
            continue
        if not any(k in content for k in KEYS):
            continue
        count += 1
        if count > 40:
            print("...(超过40条,截断)")
            sys.exit(0)
        if e.dxftype() == "TEXT":
            d = e.dxf
            print(f"[TEXT ] {sname} 内容={content[:18]!r} halign={d.get('halign',0)} valign={d.get('valign',0)} "
                  f"insert=({d.insert.x:.1f},{d.insert.y:.1f}) align=({d.get('align_point',(0,0,0))[0]:.1f},{d.get('align_point',(0,0,0))[1]:.1f}) "
                  f"h={d.height:.2f} w={d.get('width',1):.2f} rot={d.get('rotation',0):.1f} style={d.get('style','')}")
        else:
            d = e.dxf
            print(f"[MTEXT] {sname} 内容={content[:18]!r} attach={d.get('attachment_point',1)} "
                  f"insert=({d.insert.x:.1f},{d.insert.y:.1f}) h={d.get('char_height',0):.2f} rot={d.get('rotation',0):.1f} style={d.get('style','')}")
print(f"共匹配 {count} 条")
