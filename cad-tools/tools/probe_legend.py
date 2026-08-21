# -*- coding: utf-8 -*-
"""对比原图与处理后图例文字(带空格)的实体类型/对齐/坐标"""
import ezdxf

KEYS = ["防 火 门", "挡 风 墙", "风 门", "风 桥", "盘 区 线", "一水平巷道", "图 例", "图例",
        "防　火　门", "挡　风　墙", "风　门"]  # 半角/全角空格都试

def scan(path, label):
    doc = ezdxf.readfile(path)
    print(f"\n===== {label} =====")
    n = 0
    spaces = [("MODEL", doc.modelspace())] + [(f"BLK:{b.name}", b) for b in doc.blocks]
    for sname, sp in spaces:
        for e in sp.query("TEXT MTEXT"):
            try:
                content = e.dxf.text if e.dxftype() == "TEXT" else e.plain_text()
            except Exception:
                continue
            if not any(k in content for k in KEYS):
                continue
            n += 1
            if n > 25:
                print("...截断")
                return
            d = e.dxf
            if e.dxftype() == "TEXT":
                print(f"[TEXT ] {sname} {content[:16]!r} halign={d.get('halign',0)} valign={d.get('valign',0)} "
                      f"ins=({d.insert.x:.1f},{d.insert.y:.1f}) ap=({d.get('align_point',(0,0,0))[0]:.1f},{d.get('align_point',(0,0,0))[1]:.1f}) "
                      f"h={d.height:.2f} w={d.get('width',1):.3f} rot={d.get('rotation',0):.1f} st={d.get('style','')}")
            else:
                print(f"[MTEXT] {sname} {content[:16]!r} attach={d.get('attachment_point',1)} "
                      f"ins=({d.insert.x:.1f},{d.insert.y:.1f}) h={d.get('char_height',0):.2f} "
                      f"rw={d.get('rect_width',0):.1f} rot={d.get('rotation',0):.1f} st={d.get('style','')}")
    print(f"共 {n} 条")

scan(r"cad/dxf/千树塔井上下对照图（2025.04）.dxf", "原图")
scan(r"cad/dxf/processed/千树塔井上下对照图（2025.04）.dxf", "处理后")
