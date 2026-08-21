# -*- coding: utf-8 -*-
"""从处理后的千树塔中裁出图例区(包含 防 火 门 等标签的范围), 导出小 DXF 供 viewer 验证"""
import ezdxf
from ezdxf.addons import Importer

SRC = r"cad/dxf/processed/千树塔井上下对照图（2025.04）.dxf"
DST = r"cad/dxf/legend_clip.dxf"

# 图例表格紧凑范围(标签集中在 x 37413087-37413568, y 4262347-4262880)
X0, X1 = 37412900.0, 37413750.0
Y0, Y1 = 4262150.0, 4263150.0

src = ezdxf.readfile(SRC)
doc = ezdxf.new("R2010")
# 复制样式
for st in src.styles:
    name = st.dxf.name
    if name.lower() in ("standard",):
        continue
    try:
        doc.styles.add(name, font=st.dxf.font)
    except Exception:
        pass
# 复制图层
for ly in src.layers:
    name = ly.dxf.name
    if name == "0":
        continue
    try:
        doc.layers.add(name, color=ly.dxf.color, linetype=ly.dxf.linetype)
    except Exception:
        pass

dst_msp = doc.modelspace()
n = 0
importer = Importer(src, doc)
for e in src.modelspace():
    try:
        t = e.dxftype()
        if t == "LINE":
            x0 = min(e.dxf.start.x, e.dxf.end.x); x1 = max(e.dxf.start.x, e.dxf.end.x)
            y0 = min(e.dxf.start.y, e.dxf.end.y); y1 = max(e.dxf.start.y, e.dxf.end.y)
            inside = x1 >= X0 and x0 <= X1 and y1 >= Y0 and y0 <= Y1
        elif t in ("TEXT",):
            inside = X0 <= e.dxf.insert.x <= X1 and Y0 <= e.dxf.insert.y <= Y1
        elif t in ("CIRCLE", "POINT"):
            inside = X0 <= e.dxf.center.x <= X1 and Y0 <= e.dxf.center.y <= Y1 if t == "CIRCLE" else X0 <= e.dxf.location.x <= X1 and Y0 <= e.dxf.location.y <= Y1
        elif t == "ARC":
            inside = X0 <= e.dxf.center.x <= X1 and Y0 <= e.dxf.center.y <= Y1
        elif t == "SOLID":
            pts = [e.dxf.get(k) for k in ("vtx0", "vtx1", "vtx2", "vtx3")]
            xs = [p.x for p in pts]; ys = [p.y for p in pts]
            inside = max(xs) >= X0 and min(xs) <= X1 and max(ys) >= Y0 and min(ys) <= Y1
        else:
            inside = False
        if inside:
            importer.import_entity(e, dst_msp)
            n += 1
    except Exception:
        pass
importer.finalize()
doc.saveas(DST)
print(f"导出 {n} 个实体 -> {DST}")
