# -*- coding: utf-8 -*-
"""探测 HATCH 边界与 LWPOLYLINE 是否含曲线, 验证快速路径可行性"""
import sys
import time
import ezdxf

t0 = time.time()
doc = ezdxf.readfile(sys.argv[1])
print(f"加载: {time.time()-t0:.1f}s")

from ezdxf.entities import boundary_paths as bp

n_hatch = 0
hatch_all_line = 0
hatch_poly_no_bulge = 0
hatch_has_curve = 0
n_lw = 0
lw_no_bulge = 0
n_seg_total = 0  # 估算打散后的线段总数

spaces = [doc.modelspace()] + [b for b in doc.blocks if not b.name.lower().startswith(("*model_space", "*paper_space"))]

t1 = time.time()
for sp in spaces:
    for e in sp:
        t = e.dxftype()
        if t == "HATCH":
            n_hatch += 1
            ok_line = True
            ok_poly = True
            for p in e.paths:
                if isinstance(p, bp.PolylinePath):
                    if p.has_bulge():
                        ok_poly = False
                        ok_line = False
                    n_seg_total += len(p.vertices)
                elif isinstance(p, bp.EdgePath):
                    for ed in p.edges:
                        if ed.EDGE_TYPE != "LineEdge":
                            ok_line = False
                        n_seg_total += 1
                else:
                    ok_line = False
                    ok_poly = False
            if ok_line or ok_poly:
                hatch_all_line += 1
            else:
                hatch_has_curve += 1
        elif t == "LWPOLYLINE":
            n_lw += 1
            n_seg_total += len(e)
            if not any(pt[4] != 0 for pt in e.get_points("xyseb")):
                lw_no_bulge += 1
print(f"扫描: {time.time()-t1:.1f}s")
print(f"HATCH: 总数={n_hatch}, 全直线边界={hatch_all_line}, 含曲线={hatch_has_curve}")
print(f"LWPOLYLINE: 总数={n_lw}, 无凸度(纯直线)={lw_no_bulge}")
print(f"打散后线段估算(未计曲线细分): {n_seg_total}")
