# -*- coding: utf-8 -*-
"""从 6#煤 原图与处理后图纸中裁出图例区(防火门等标签范围), 导出小 DXF 供 viewer 对比验证"""
import os
import ezdxf
from ezdxf.addons import Importer

JOBS = [
    (r"cad/dxf/6#煤采掘工程平面图（2025.05）.dxf",
     r"cad-viewer/packages/cad-simple-viewer-example/public/testdata/legend6_orig.dxf"),
    (r"cad/dxf/processed/6#煤采掘工程平面图（2025.05）.dxf",
     r"cad-viewer/packages/cad-simple-viewer-example/public/testdata/legend6_new.dxf"),
]

# 图例表格范围(标签集中在 x 37413496-37413553, y 4262510-4262929)
X0, X1 = 37412900.0, 37413800.0
Y0, Y1 = 4262150.0, 4263150.0


def clip(src_path, dst_path):
    src = ezdxf.readfile(src_path)
    doc = ezdxf.new("R2010")
    for st in src.styles:
        name = st.dxf.name
        if name.lower() in ("standard",):
            continue
        try:
            doc.styles.add(name, font=st.dxf.font)
        except Exception:
            pass
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
            elif t == "TEXT":
                inside = X0 <= e.dxf.insert.x <= X1 and Y0 <= e.dxf.insert.y <= Y1
            elif t == "CIRCLE":
                inside = X0 <= e.dxf.center.x <= X1 and Y0 <= e.dxf.center.y <= Y1
            elif t == "POINT":
                inside = X0 <= e.dxf.location.x <= X1 and Y0 <= e.dxf.location.y <= Y1
            elif t == "ARC":
                inside = X0 <= e.dxf.center.x <= X1 and Y0 <= e.dxf.center.y <= Y1
            elif t == "SOLID":
                pts = [e.dxf.get(k) for k in ("vtx0", "vtx1", "vtx2", "vtx3")]
                xs = [p.x for p in pts]; ys = [p.y for p in pts]
                inside = max(xs) >= X0 and min(xs) <= X1 and max(ys) >= Y0 and min(ys) <= Y1
            elif t == "LWPOLYLINE":
                pts = list(e.get_points())
                xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
                inside = max(xs) >= X0 and min(xs) <= X1 and max(ys) >= Y0 and min(ys) <= Y1
            else:
                inside = False
            if inside:
                importer.import_entity(e, dst_msp)
                n += 1
        except Exception:
            pass
    importer.finalize()
    os.makedirs(os.path.dirname(dst_path), exist_ok=True)
    doc.saveas(dst_path)
    print(f"{os.path.basename(src_path)}: 导出 {n} 个实体 -> {dst_path}")


for src, dst in JOBS:
    clip(src, dst)
