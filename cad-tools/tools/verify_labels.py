# -*- coding: utf-8 -*-
"""对比原始图纸与处理后图纸中指定文字的渲染中心位置"""
import sys
sys.path.insert(0, r"cad-tools")
import ezdxf
from process_dxf import _measure_font

KEYS = ["防爆密闭门", "调节风门", "防火栅栏门", "正反向风门"]

src = ezdxf.readfile(r"cad/dxf/千树塔井上下对照图（2025.04）.dxf")
out = ezdxf.readfile(r"cad/dxf/processed/千树塔井上下对照图（2025.04）.dxf")

def text_width(s, h, w, ttf):
    return _measure_font(ttf, h, w).text_width(s)

# 原图模型空间的对齐点(渲染中心)
orig = {}
for e in src.modelspace().query("TEXT"):
    c = e.dxf.text.strip()
    if c in KEYS and e.dxf.get("halign", 0) == 1:
        orig.setdefault(c, []).append((e.dxf.align_point.x, e.dxf.align_point.y,
                                       e.dxf.height, e.dxf.get("width", 1.0)))

print("== 处理后模型空间 TEXT(应为左对齐, 中心应与原对齐点重合) ==")
n = 0
for e in out.modelspace().query("TEXT"):
    c = e.dxf.text.strip()
    if c not in KEYS:
        continue
    n += 1
    if n > 12:
        break
    h, w = e.dxf.height, e.dxf.get("width", 1.0)
    tw = text_width(c, h, w, "simsun.ttf")
    cx, cy = e.dxf.insert.x + tw / 2, e.dxf.insert.y
    # 与原图任一对齐点比较
    best = None
    for (ax, ay, oh, ow) in orig.get(c, []):
        d = ((cx - ax) ** 2 + (cy - ay) ** 2) ** 0.5
        if best is None or d < best:
            best = d
    print(f"{c}: insert=({e.dxf.insert.x:.1f},{e.dxf.insert.y:.1f}) h={h} w={w:.2f} "
          f"halign={e.dxf.get('halign',0)} 中心偏差={best if best is not None else float('nan'):.2f}")
