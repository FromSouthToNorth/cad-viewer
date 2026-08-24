# -*- coding: utf-8 -*-
"""
CAD DXF 图纸批量处理脚本 (基于 ezdxf 1.4)

处理内容:
  1. 图层处理: 清洗删除相同属性/坐标的重复实体; 删除关闭(OFF)/冻结(FROZEN)图层的实体与图层,
     删除锁定(LOCKED)图层的实体与图层; PURGE 清理无用对象减小体积; 删除无法加载的外部参照块
  2. 文本处理: 多行文本(MTEXT)转单行文本(TEXT, 数字不拆散), 全部左对齐(JUSTIFYTEXT)
  3. 打散: 填充(HATCH)打散为边界线, 表格(ACAD_TABLE)打散, 块(INSERT)递归打散, 外部参照(XREF)绑定后打散
  4. 文字处理: 字体统一为宋体(simsun.ttf); 高度 = 原高度 * 宽度因子, 宽度因子归 1
  5. 线段处理: 多段线打断为直线段; 删除长度<=0.1的直线段; 直线/圆弧厚度归 0

用法:
  python cad-tools/process_dxf.py [--src cad/dxf] [--out cad/dxf/processed] [--only 部分文件名]
"""

import argparse
import math
import sys
import time
import traceback
from datetime import datetime
from pathlib import Path

import ezdxf
from ezdxf import explode, path, xref
from ezdxf.entities.boundary_paths import EdgePath, PolylinePath
from ezdxf.enums import TextEntityAlignment
from ezdxf.fonts import fonts as ezfonts
from ezdxf.math import Vec3
from ezdxf.tools.text import TextLine, unified_alignment

FONT_TTF = "simsun.ttf"          # 宋体
FLATTEN_DIST = 0.05              # 曲线离散为直线的最大弦高误差
MIN_LINE_LEN = 0.1               # 删除长度<=该值的直线段
EPS = 1e-6
MAX_EXPLODE_DEPTH = 32           # 块递归打散最大层数
LOG_DIR = "cad-tools/logs"       # 日志文件目录


class Stats:
    def __init__(self):
        self.file_name = ""
        self.start_time = None
        self.end_time = None
        self.xref = 0
        self.blocks = 0
        self.tables = 0
        self.hatches = 0
        self.mtext = 0
        self.justified = 0
        self.fonts = 0
        self.heights = 0
        self.polylines = 0
        self.short_lines = 0
        self.thickness = 0
        self.dup_removed = 0
        self.empty_layers = 0
        self.xref_removed = 0
        self.layer_entities = 0
        self.bad_layers = 0
        self.blocks_purged = 0
        self.warnings = []

    def warn(self, msg):
        self.warnings.append(msg)
        print(f"    [警告] {msg}")

    def dump(self):
        print(f"    外部参照绑定: {self.xref}  块打散: {self.blocks}  表格打散: {self.tables}  "
              f"填充打散: {self.hatches}")
        print(f"    多行文本转单行: {self.mtext}  左对齐: {self.justified}  字体样式: {self.fonts}  "
              f"高度按宽度因子换算: {self.heights}")
        print(f"    多段线打断: {self.polylines}  删除短线段(<= {MIN_LINE_LEN}): {self.short_lines}  "
              f"厚度归零: {self.thickness}")
        print(f"    重复实体删除: {self.dup_removed}  空图层删除: {self.empty_layers}")
        print(f"    关闭/冻结/锁定图层实体删除: {self.layer_entities}  图层移除: {self.bad_layers}  "
              f"无法引用参照块删除: {self.xref_removed}  无用块清理: {self.blocks_purged}")

    def to_dict(self):
        """转换为字典格式,用于日志输出"""
        duration = ""
        if self.start_time and self.end_time:
            delta = (self.end_time - self.start_time).total_seconds()
            duration = f"{delta:.2f}s"
        return {
            "文件名": self.file_name,
            "处理时间": duration,
            "外部参照绑定": self.xref,
            "块打散": self.blocks,
            "表格打散": self.tables,
            "填充打散": self.hatches,
            "多行文本转单行": self.mtext,
            "左对齐": self.justified,
            "字体样式": self.fonts,
            "高度按宽度因子换算": self.heights,
            "多段线打断": self.polylines,
            "删除短线段": self.short_lines,
            "厚度归零": self.thickness,
            "重复实体删除": self.dup_removed,
            "空图层删除": self.empty_layers,
            "关闭/冻结/锁定图层实体删除": self.layer_entities,
            "图层移除": self.bad_layers,
            "无法引用参照块删除": self.xref_removed,
            "无用块清理": self.blocks_purged,
            "警告数": len(self.warnings),
        }


def common_attribs(e):
    """提取实体通用显示属性"""
    attribs = {}
    for key in ("layer", "color", "linetype", "lineweight", "ltscale", "true_color"):
        try:
            attribs[key] = getattr(e.dxf, key)
        except Exception:
            pass
    return attribs


def batch_delete(doc, sp, entities):
    """批量删除实体: 数据库逐个销毁(O(1)/个), 最后一次重建实体空间(O(n)).
    layout.delete_entity 走 list.remove 是 O(n), 循环删除会退化为 O(n^2)"""
    db = doc.entitydb
    for e in entities:
        db.delete_entity(e)
    sp.block_record.entity_space.purge()


# ---------------------------------------------------------------- 1. 外部参照

def bind_xrefs(doc, drawing_dir, stats):
    """加载(绑定)外部参照文件, 使后续块打散能展开其内容; 返回绑定失败的块名列表"""
    failed = []
    for br in list(doc.block_records):
        try:
            is_xr = br.is_xref
        except Exception:
            is_xr = False
        if not is_xr:
            continue
        name = br.dxf.name
        try:
            bl = doc.blocks.get(name)
            xref.embed(bl, search_paths=[str(drawing_dir)])
            stats.xref += 1
            print(f"    外部参照已绑定: {name}")
        except Exception as ex:
            failed.append(name)
            stats.warn(f"外部参照 {name} 绑定失败(文件缺失?): {ex}")
    return failed


def remove_failed_xrefs(doc, failed, stats):
    """删除外部无法引用(绑定失败)的参照块: 删除其所有 INSERT 并移除块定义"""
    names = set(failed)
    if not names:
        return
    for sp in all_spaces(doc):
        doomed = []
        for e in list(sp):
            try:
                if e.dxftype() == "INSERT" and e.dxf.name in names:
                    doomed.append(e)
                    stats.xref_removed += 1
            except Exception:
                pass
        if doomed:
            batch_delete(doc, sp, doomed)
    for name in names:
        try:
            doc.blocks.delete_block(name, safe=False)
            stats.blocks_purged += 1
        except Exception:
            pass


def all_spaces(doc):
    """模型/图纸空间 + 所有非布局块定义 (布局块与布局共享实体空间, 避免重复)"""
    spaces = list(doc.layouts)
    for bl in doc.blocks:
        if bl.name.lower().startswith(("*model_space", "*paper_space")):
            continue
        spaces.append(bl)
    return spaces


# ---------------------------------------------------------------- 2. 打散

def explode_blocks(msp, stats):
    """递归打散所有块参照"""
    failed = set()  # 打散失败的 INSERT 句柄, 下轮不再重试
    depth = 0
    while depth < MAX_EXPLODE_DEPTH:
        inserts = [i for i in msp.query("INSERT") if i.dxf.handle not in failed]
        if not inserts:
            break
        exploded = 0
        for ins in inserts:
            try:
                explode.explode_entity(ins, target_layout=msp)  # 源实体随之销毁
                stats.blocks += 1
                exploded += 1
            except Exception as ex:
                failed.add(ins.dxf.handle)
                stats.warn(f"块 {ins.dxf.name} 打散失败, 保留原样: {ex}")
        depth += 1
        if exploded == 0:
            break
    if failed:
        stats.warn(f"共 {len(failed)} 个块参照无法打散")


def explode_tables(msp, stats):
    """表格打散 (ACAD_TABLE 内容是匿名块, 尝试直接 explode)"""
    for tbl in list(msp.query("ACAD_TABLE")):
        try:
            if hasattr(tbl, "virtual_entities"):
                explode.explode_entity(tbl, target_layout=msp)
                stats.tables += 1
            else:
                stats.warn("ACAD_TABLE 不支持 virtual_entities, 跳过")
        except Exception as ex:
            stats.warn(f"表格打散失败: {ex}")


def flatten_path_to_lines(p):
    pts = list(p.flattening(FLATTEN_DIST))
    if p.is_closed and len(pts) > 1 and not pts[0].isclose(pts[-1], abs_tol=EPS):
        pts.append(pts[0])
    return [(a, b) for a, b in zip(pts, pts[1:]) if not a.isclose(b, abs_tol=EPS)]


def hatch_straight_segments(hatch):
    """HATCH 边界全部为直线段时直接返回线段列表 (等价于 path.from_hatch + flattening);
    含曲线边界或非 WCS 时返回 None, 走慢速路径"""
    try:
        if not hatch.dxf.extrusion.isclose(Vec3(0, 0, 1), abs_tol=EPS):
            return None
        z = hatch.dxf.elevation.z
    except Exception:
        return None
    segs = []
    for p in hatch.paths:
        if isinstance(p, PolylinePath):
            if p.has_bulge():
                return None
            pts = [Vec3(v[0], v[1], z) for v in p.vertices]
            if p.is_closed and len(pts) > 1 and not pts[0].isclose(pts[-1], abs_tol=EPS):
                pts.append(pts[0])
            segs.extend((a, b) for a, b in zip(pts, pts[1:]) if not a.isclose(b, abs_tol=EPS))
        elif isinstance(p, EdgePath):
            for ed in p.edges:
                if ed.EDGE_TYPE != "LineEdge":
                    return None
                a = Vec3(ed.start.x, ed.start.y, z)
                b = Vec3(ed.end.x, ed.end.y, z)
                if not a.isclose(b, abs_tol=EPS):
                    segs.append((a, b))
        else:
            return None
    return segs


def explode_hatches(doc, msp, stats):
    """填充打散: 以填充边界路径生成直线段, 删除原 HATCH"""
    doomed = []
    for hatch in list(msp.query("HATCH")):
        attribs = common_attribs(hatch)
        try:
            segs = hatch_straight_segments(hatch)
            if segs is None:
                segs = []
                for p in path.from_hatch(hatch):
                    segs.extend(flatten_path_to_lines(p))
            for a, b in segs:
                msp.add_line(a, b, dxfattribs=dict(attribs))
            doomed.append(hatch)
            stats.hatches += 1
        except Exception as ex:
            stats.warn(f"填充打散失败, 保留原样: {ex}")
    if doomed:
        batch_delete(doc, msp, doomed)


# ---------------------------------------------------------------- 3. 文本处理

def mtext_to_text(doc, msp, stats):
    """多行文本转单行文本; 数字等内容不拆散, 始终生成一个 TEXT.
    MTEXT 插入点是 9 宫格对齐点(默认左上), TEXT 左对齐的锚点是首行基线左端,
    需按对齐点反算偏移, 否则文字会竖直/水平错位"""
    doomed = []
    for m in list(msp.query("MTEXT")):
        try:
            lines = m.plain_text().replace("\\P", "\n").split("\n")
            content = " ".join(lines).strip()
            attribs = common_attribs(m)
            attribs["style"] = m.dxf.style
            attribs["rotation"] = m.dxf.rotation
            attribs["height"] = m.dxf.char_height
            attribs["insert"] = _mtext_baseline_insert(m, lines, doc)
            attribs["width"] = 1.0
            if content:
                msp.add_text(content, dxfattribs=attribs)
                stats.mtext += 1
            doomed.append(m)
        except Exception as ex:
            stats.warn(f"MTEXT 转换失败: {ex}")
    if doomed:
        batch_delete(doc, msp, doomed)


def _style_font(doc, name):
    """文字样式对应的 TTF 文件名; 样式不存在时返回空串(走默认字体度量)"""
    if name and doc.styles.has_entry(name):
        return doc.styles.get(name).dxf.font or ""
    return ""


def _mtext_baseline_insert(m, lines, doc):
    """由 MTEXT 9 宫格对齐点反算首行基线左端点.
    列: 1/4/7 左, 2/5/8 中, 3/6/9 右; 行: 1-3 上, 4-6 中, 7-9 下"""
    d = m.dxf
    ap = d.get("attachment_point", 1)
    h = d.get("char_height", 0.0) or 1.0
    if ap == 1:  # 左上: 首行基线在对齐点下方一个字高处
        off = Vec3(0, -h, 0)
    else:
        col, row = (ap - 1) % 3, (ap - 1) // 3
        box_w = d.get("rect_width", 0.0) or 0.0
        if col and box_w <= EPS:  # 无换行框宽时按最长行实测宽度估算
            font = _measure_font(_style_font(doc, d.get("style", "")), h, 1.0)
            box_w = max((font.text_width(ln) for ln in lines), default=0.0)
        spacing = h * d.get("line_spacing_factor", 1.0) * 5.0 / 3.0
        box_h = h + (len(lines) - 1) * spacing + 0.2 * h
        dx = (0.0, -box_w / 2.0, -box_w)[col]
        dy = (-h, box_h / 2.0 - h, box_h - h)[row]
        off = Vec3(dx, dy, 0)
    angle = math.radians(d.get("rotation", 0.0))
    return Vec3(d.insert) + off.rotate(angle)


def justify_left(doc, msp, stats):
    """JUSTIFYTEXT: 所有单行文本设置为靠左对齐, 且渲染位置保持不变.
    改为左对齐后渲染锚点从对齐点(组码11)变为插入点(组码10), 若直接把对齐点当
    插入点, 居中/右对齐文字会整体平移(居中右移半个字宽); 必须按原对齐方式反算
    基线左端点作为新插入点"""
    for t in list(msp.query("TEXT")):
        try:
            align = t.get_align_enum()
            if align != TextEntityAlignment.LEFT:
                if align not in (TextEntityAlignment.ALIGNED, TextEntityAlignment.FIT):
                    # ALIGNED/FIT 的插入点本就是基线左端, 无需移动
                    t.dxf.insert = _left_baseline_point(t, doc)
                t.set_align_enum(TextEntityAlignment.LEFT)
                stats.justified += 1
            # 统一清除残留对齐点(包括本来就是左对齐的文本): 前端在组码11有效
            # (非零且不等于组码10)时优先用它做锚点, 残留旧值会导致渲染锚点错误
            t.dxf.align_point = t.dxf.insert
        except Exception as ex:
            stats.warn(f"文本左对齐失败: {ex}")


_font_cache = {}


def _measure_font(ttf, h, wf):
    """按 (字体, 字高, 宽度因子) 缓存字体度量对象, 避免重复构造与告警刷屏"""
    key = (ttf, round(h, 4), round(wf, 4))
    font = _font_cache.get(key)
    if font is None:
        try:
            font = ezfonts.make_font(ttf or FONT_TTF, h, wf)
        except Exception:
            font = ezfonts.MonospaceFont(h, wf)
        _font_cache[key] = font
    return font


def _left_baseline_point(t, doc):
    """按 TEXT 当前对齐方式反算渲染基线的左端点(OCS 坐标).
    复用 ezdxf 渲染器的定位逻辑: baseline_vertices 以对齐点为锚返回基线两端"""
    d = t.dxf
    h = d.height
    style = None
    if d.hasattr("style") and doc.styles.has_entry(d.style):
        style = doc.styles.get(d.style)
    if not h and style is not None:
        h = style.dxf.height or 0.0
    if not h:
        h = 1.0
    wf = d.get("width", 1.0) or 1.0
    ttf = style.dxf.font if style is not None else ""
    font = _measure_font(ttf, h, wf)
    halign, valign = unified_alignment(t)
    angle = math.radians(d.get("rotation", 0.0))
    return TextLine(d.text, font).baseline_vertices(d.align_point, halign, valign, angle)[0]


# ---------------------------------------------------------------- 4. 文字(字体/字高)

def unify_fonts(doc, stats):
    """所有文字样式统一为宋体"""
    for st in doc.styles:
        try:
            st.dxf.font = FONT_TTF
            try:
                st.dxf.bigfont = ""
            except Exception:
                pass
            stats.fonts += 1
            # 样式级宽度因子同样折算进固定字高
            w = getattr(st.dxf, "width", 1.0) or 1.0
            h = getattr(st.dxf, "height", 0.0) or 0.0
            if abs(w - 1.0) > EPS and h > 0:
                st.dxf.height = h * w
            if abs(w - 1.0) > EPS:
                st.dxf.width = 1.0
        except Exception as ex:
            stats.warn(f"样式 {st.dxf.name} 字体设置失败: {ex}")


def fix_text_height(msp, doc, stats):
    """高度 = 原高度 * 宽度因子, 宽度因子归 1"""
    style_h = {s.dxf.name: (s.dxf.height or 0.0) for s in doc.styles}
    for t in list(msp.query("TEXT")):
        try:
            w = t.dxf.width or 1.0
            if abs(w - 1.0) <= EPS:
                continue
            h = t.dxf.height
            if not h:  # 高度为0时取样式固定高度
                h = style_h.get(t.dxf.style, 0.0)
            if h > 0:
                t.dxf.height = h * w
            t.dxf.width = 1.0
            stats.heights += 1
        except Exception as ex:
            stats.warn(f"字高换算失败: {ex}")


# ---------------------------------------------------------------- 5. 线段处理

def lwpolyline_straight_segments(e):
    """LWPOLYLINE 无凸度(纯直线)时直接返回线段; 否则返回 None 走 path 慢速路径"""
    z = e.dxf.elevation
    pts = []
    for x, y, bulge in e.get_points("xyb"):
        if bulge:
            return None
        pts.append(Vec3(x, y, z))
    if e.closed and pts:
        pts.append(pts[0])
    return [(a, b) for a, b in zip(pts, pts[1:]) if not a.isclose(b, abs_tol=EPS)]


def polyline_straight_segments(e):
    """POLYLINE 无凸度/无曲线拟合时直接返回线段; 否则返回 None 走 path 慢速路径"""
    if e.is_3d_polyline:
        pts = [v.dxf.location for v in e.vertices]
    elif e.is_2d_polyline:
        if e.dxf.flags & 6:  # 曲线拟合(2)/样条拟合(4)需走慢速路径
            return None
        pts = []
        for v in e.vertices:
            if v.dxf.bulge:
                return None
            pts.append(v.dxf.location)
    else:
        return None  # 多面网格等
    if e.is_closed and pts:
        pts.append(pts[0])
    return [(a, b) for a, b in zip(pts, pts[1:]) if not a.isclose(b, abs_tol=EPS)]


def polylines_to_lines(doc, msp, stats):
    """多段线(LWPOLYLINE/POLYLINE)打断为直线段"""
    doomed = []
    for e in list(msp.query("LWPOLYLINE POLYLINE")):
        attribs = common_attribs(e)
        try:
            if e.dxftype() == "LWPOLYLINE":
                segs = lwpolyline_straight_segments(e)
            else:
                segs = polyline_straight_segments(e)
        except Exception:
            segs = None
        if segs is None:
            try:
                p = path.make_path(e)
                segs = flatten_path_to_lines(p)
            except Exception:
                # 退化方案: 直接按顶点连线
                try:
                    if e.dxftype() == "LWPOLYLINE":
                        pts = [Vec3(pt[0], pt[1], 0) for pt in e.get_points("xy")]
                        closed = e.closed
                    else:
                        pts = [v.dxf.location for v in e.vertices]
                        closed = e.is_closed
                    if closed and pts:
                        pts.append(pts[0])
                    segs = [(a, b) for a, b in zip(pts, pts[1:]) if not a.isclose(b, abs_tol=EPS)]
                except Exception as ex:
                    stats.warn(f"多段线打断失败: {ex}")
                    continue
        for a, b in segs:
            msp.add_line(a, b, dxfattribs=dict(attribs))
        doomed.append(e)
        stats.polylines += 1
    if doomed:
        batch_delete(doc, msp, doomed)


def delete_short_lines(doc, msp, stats):
    """删除长度<=0.1的直线段 (在多段线打断之后执行)"""
    doomed = []
    for ln in list(msp.query("LINE")):
        try:
            if (ln.dxf.end - ln.dxf.start).magnitude <= MIN_LINE_LEN + EPS:
                doomed.append(ln)
                stats.short_lines += 1
        except Exception:
            pass
    if doomed:
        batch_delete(doc, msp, doomed)


def reset_thickness(msp, stats):
    """直线/圆弧厚度归零"""
    for e in list(msp.query("LINE ARC")):
        try:
            if abs(getattr(e.dxf, "thickness", 0.0) or 0.0) > EPS:
                e.dxf.thickness = 0.0
                stats.thickness += 1
        except Exception:
            pass


# ---------------------------------------------------------------- 6. 清洗

def collect_bad_layers(doc):
    """关闭(OFF)/冻结(FROZEN)/锁定(LOCKED)的图层名集合"""
    bad = set()
    for layer in doc.layers:
        try:
            if layer.is_off() or layer.is_frozen() or layer.is_locked():
                bad.add(layer.dxf.name)
        except Exception:
            pass
    return bad


def delete_entities_on_layers(doc, layers, stats):
    """删除位于指定图层上的所有实体 (含块定义内部)"""
    if not layers:
        return
    for sp in all_spaces(doc):
        doomed = []
        for e in list(sp):
            try:
                if e.dxf.is_supported("layer") and e.dxf.layer in layers:
                    doomed.append(e)
                    stats.layer_entities += 1
            except Exception:
                pass
        if doomed:
            batch_delete(doc, sp, doomed)


def remove_bad_layers(doc, layers, stats):
    """从图层表中移除关闭/冻结/锁定图层"""
    for name in sorted(layers):
        try:
            doc.layers.remove(name)
            stats.bad_layers += 1
        except Exception as ex:
            stats.warn(f"图层 {name} 移除失败: {ex}")


def purge_unused_blocks(doc, stats):
    """PURGE: 删除不再被任何 INSERT 引用的块定义"""
    referenced = set()
    keep_anonymous = False
    for sp in all_spaces(doc):
        for e in sp:
            t = e.dxftype()
            if t == "INSERT":
                referenced.add(e.dxf.name)
            elif t in ("DIMENSION", "LEADER", "MULTILEADER", "ACAD_TABLE"):
                keep_anonymous = True
    # DIMSTYLE 的箭头/引线块 (dimblk 等) 以块名引用, 不能删
    for ds in doc.dimstyles:
        for attr in ("dimblk", "dimblk1", "dimblk2", "dimldrblk"):
            try:
                v = getattr(ds.dxf, attr, "") or ""
            except Exception:
                continue
            v = v.strip()
            if v:
                referenced.add(v)
                referenced.add((getattr(ds.dxf, attr, "") or ""))  # 原始值(可能带空格)也保护
    for bl in list(doc.blocks):
        name = bl.name
        if name.lower().startswith(("*model_space", "*paper_space")):
            continue
        if name in referenced:
            continue
        if keep_anonymous and name.startswith("*"):
            continue  # 尺寸/表格仍在使用的匿名块
        try:
            doc.blocks.delete_block(name, safe=False)
            stats.blocks_purged += 1
        except Exception:
            pass


def purge_entitydb(doc):
    """PURGE: 从数据库物理回收已删除实体, 减小文件体积"""
    try:
        doc.entitydb.purge()
    except Exception:
        pass


# ---------------------------------------------------------------- 日志

def format_log_line(key, value, width=30):
    """格式化日志行: key=value 对齐"""
    return f"{str(key):<{width}} = {value}"


def write_file_log(stats, log_dir):
    """写入单个文件的处理日志"""
    log_dir = Path(log_dir)
    log_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    log_file = log_dir / f"process_{timestamp}.log"

    with open(log_file, "a", encoding="utf-8") as f:
        f.write(f"\n{'='*80}\n")
        f.write(f"文件: {stats.file_name}\n")
        if stats.start_time and stats.end_time:
            delta = (stats.end_time - stats.start_time).total_seconds()
            f.write(f"处理时间: {delta:.2f} 秒\n")
        f.write(f"{'='*80}\n")

        f.write("\n[清洗统计]\n")
        data = stats.to_dict()
        for key, value in data.items():
            if key not in ("文件名", "处理时间", "警告数"):
                f.write(format_log_line(key, value) + "\n")

        if stats.warnings:
            f.write(f"\n[警告信息] ({len(stats.warnings)} 条)\n")
            for i, warn in enumerate(stats.warnings, 1):
                f.write(f"  {i}. {warn}\n")

    return log_file


def write_summary_log(all_stats, total_count, success_count, log_dir):
    """写入批量处理的汇总日志"""
    log_dir = Path(log_dir)
    log_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    log_file = log_dir / f"summary_{timestamp}.log"

    with open(log_file, "w", encoding="utf-8") as f:
        f.write(f"{'='*80}\n")
        f.write(f"DXF 批量处理汇总日志\n")
        f.write(f"生成时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
        f.write(f"{'='*80}\n\n")

        f.write(f"总文件数: {total_count}\n")
        f.write(f"成功处理: {success_count}\n")
        f.write(f"失败数量: {total_count - success_count}\n")
        f.write(f"成功率: {success_count/total_count*100:.1f}%\n\n")

        # 汇总所有文件的统计
        summary = Stats()
        for stats in all_stats:
            summary.xref += stats.xref
            summary.blocks += stats.blocks
            summary.tables += stats.tables
            summary.hatches += stats.hatches
            summary.mtext += stats.mtext
            summary.justified += stats.justified
            summary.fonts += stats.fonts
            summary.heights += stats.heights
            summary.polylines += stats.polylines
            summary.short_lines += stats.short_lines
            summary.thickness += stats.thickness
            summary.dup_removed += stats.dup_removed
            summary.empty_layers += stats.empty_layers
            summary.xref_removed += stats.xref_removed
            summary.layer_entities += stats.layer_entities
            summary.bad_layers += stats.bad_layers
            summary.blocks_purged += stats.blocks_purged
            summary.warnings.extend(stats.warnings)

        f.write(f"{'='*80}\n")
        f.write(f"总计清洗统计\n")
        f.write(f"{'='*80}\n")
        data = summary.to_dict()
        for key, value in data.items():
            if key not in ("文件名", "处理时间"):
                f.write(format_log_line(key, value) + "\n")

        f.write(f"\n{'='*80}\n")
        f.write(f"各文件详细统计\n")
        f.write(f"{'='*80}\n\n")

        for stats in all_stats:
            f.write(f"--- {stats.file_name} ---\n")
            data = stats.to_dict()
            for key, value in data.items():
                if key not in ("文件名", "警告数"):
                    f.write(f"  {format_log_line(key, value, 25)}\n")
            if stats.warnings:
                f.write(f"  警告 ({len(stats.warnings)} 条):\n")
                for warn in stats.warnings:
                    f.write(f"    - {warn}\n")
            f.write("\n")

    return log_file

def _norm(v):
    if isinstance(v, float):
        return round(v, 6)
    if isinstance(v, Vec3):
        return tuple(round(c, 6) for c in v.xyz)
    if isinstance(v, (tuple, list)):
        return tuple(_norm(x) for x in v)
    return v


def _v6(p):
    return (round(p[0], 6), round(p[1], 6), round(p[2], 6))


def fast_dedup_key(e):
    """高频实体类型的快速去重键 (等价于完整 dxfattribs 键, 但快数十倍);
    返回 None 表示需回退到完整属性导出"""
    t = e.dxftype()
    dxf = e.dxf
    common = (t, dxf.get("layer"), dxf.get("color"), dxf.get("linetype"),
              dxf.get("lineweight"), _norm(dxf.get("ltscale", 1.0)), dxf.get("true_color"))
    try:
        if t == "LINE":
            return common + (_v6(dxf.start), _v6(dxf.end),
                             _norm(dxf.get("thickness", 0.0)), _v6(dxf.extrusion))
        if t == "TEXT":
            return common + (_v6(dxf.insert), _v6(dxf.align_point), dxf.text,
                             _norm(dxf.get("height", 0.0)), _norm(dxf.get("width", 1.0)),
                             _norm(dxf.get("rotation", 0.0)), _norm(dxf.get("oblique", 0.0)),
                             dxf.get("style"), dxf.get("halign", 0), dxf.get("valign", 0),
                             dxf.get("text_generation_flag", 0))
        if t == "ARC":
            return common + (_v6(dxf.center), _norm(dxf.radius),
                             _norm(dxf.start_angle), _norm(dxf.end_angle),
                             _norm(dxf.get("thickness", 0.0)), _v6(dxf.extrusion))
        if t == "CIRCLE":
            return common + (_v6(dxf.center), _norm(dxf.radius),
                             _norm(dxf.get("thickness", 0.0)), _v6(dxf.extrusion))
        if t == "POINT":
            return common + (_v6(dxf.location),)
    except Exception:
        return None
    return None


def dedup_entities(doc, msp, stats):
    """删除相同属性/坐标的重复实体 (OVERKILL)"""
    seen = set()
    doomed = []
    for e in list(msp):
        try:
            key = fast_dedup_key(e)
            if key is None:
                if not hasattr(e, "dxfattribs"):
                    continue
                attribs = e.dxfattribs()
                key_items = []
                for k, v in sorted(attribs.items()):
                    if k in ("handle", "owner"):
                        continue
                    nv = _norm(v)
                    try:
                        hash(nv)
                    except TypeError:
                        nv = repr(nv)
                    key_items.append((k, nv))
                key = (e.dxftype(), tuple(key_items))
            if key in seen:
                doomed.append(e)
                stats.dup_removed += 1
            else:
                seen.add(key)
        except Exception:
            continue
    if doomed:
        batch_delete(doc, msp, doomed)


def purge_empty_layers(doc, stats):
    """清理没有任何实体的空图层 (保留 0 / Defpoints)"""
    used = set()
    for layout in doc.layouts:
        for e in layout:
            if hasattr(e, "dxf") and e.dxf.is_supported("layer"):
                used.add(e.dxf.layer)
    for bl in doc.blocks:
        for e in bl:
            if hasattr(e, "dxf") and e.dxf.is_supported("layer"):
                used.add(e.dxf.layer)
    for layer in list(doc.layers):
        name = layer.dxf.name
        if name.lower() in ("0", "defpoints"):
            continue
        if name not in used:
            try:
                doc.layers.remove(name)
                stats.empty_layers += 1
            except Exception:
                pass


# ---------------------------------------------------------------- 主流程

def process_file(src: Path, out_dir: Path):
    print(f"[处理] {src.name}")
    stats = Stats()
    stats.file_name = src.name
    stats.start_time = datetime.now()
    t0 = time.time()
    try:
        doc = ezdxf.readfile(str(src))
    except Exception:
        try:
            from ezdxf import recover
            doc, _auditor = recover.readfile(str(src))
            print("    常规读取失败, 已使用 recover 模式读取")
        except Exception as ex:
            print(f"    [错误] 无法读取文件: {ex}")
            stats.end_time = datetime.now()
            write_file_log(stats, LOG_DIR)
            return False
    print(f"    [{time.time() - t0:8.1f}s] 加载文件")

    msp = doc.modelspace()

    def run(label, fn, *args):
        """执行一个处理阶段并打印耗时"""
        t0 = time.time()
        r = fn(*args)
        print(f"    [{time.time() - t0:8.1f}s] {label} (模型空间实体: {len(msp)})")
        return r

    bad_layers = collect_bad_layers(doc)        # 关闭/冻结/锁定图层
    run("删除坏图层实体(1)", delete_entities_on_layers, doc, bad_layers, stats)
    failed_xrefs = bind_xrefs(doc, src.parent, stats)   # 外部参照绑定
    run("删除无法引用的参照块", remove_failed_xrefs, doc, failed_xrefs, stats)
    run("表格打散", explode_tables, msp, stats)
    run("块递归打散", explode_blocks, msp, stats)
    run("填充打散", explode_hatches, doc, msp, stats)
    run("多行文本转单行", mtext_to_text, doc, msp, stats)
    run("左对齐", justify_left, doc, msp, stats)
    run("字体统一宋体", unify_fonts, doc, stats)
    run("字高换算", fix_text_height, msp, doc, stats)
    run("多段线打断", polylines_to_lines, doc, msp, stats)
    run("删除短线段", delete_short_lines, doc, msp, stats)
    run("厚度归零", reset_thickness, msp, stats)
    run("删除重复实体", dedup_entities, doc, msp, stats)
    run("删除坏图层实体(2)", delete_entities_on_layers, doc, bad_layers, stats)
    run("移除坏图层", remove_bad_layers, doc, bad_layers, stats)
    run("清理空图层", purge_empty_layers, doc, stats)
    run("清理无用块", purge_unused_blocks, doc, stats)
    run("回收实体数据库", purge_entitydb, doc)

    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / src.name
    try:
        doc.saveas(str(out))
        print(f"    已保存: {out}")
        stats.dump()
        stats.end_time = datetime.now()
        log_file = write_file_log(stats, LOG_DIR)
        print(f"    日志已保存: {log_file}")
        return stats
    except Exception as ex:
        print(f"    [错误] 保存失败: {ex}")
        traceback.print_exc()
        stats.end_time = datetime.now()
        write_file_log(stats, LOG_DIR)
        return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default="cad/dxf")
    ap.add_argument("--out", default="cad/dxf/processed")
    ap.add_argument("--only", default=None, help="只处理文件名包含该字符串的图纸")
    ap.add_argument("--max-size", type=int, default=None,
                    help="只处理小于指定大小(KB)的文件,例如 100000 表示 100MB")
    ap.add_argument("--skip-processed", action="store_true",
                    help="跳过输出目录中已存在同名文件的图纸")
    args = ap.parse_args()

    src_dir = Path(args.src)
    out_dir = Path(args.out)
    files = sorted(p for p in src_dir.glob("*.dxf") if p.is_file())
    if args.only:
        files = [p for p in files if args.only in p.name]
    if args.max_size is not None:
        max_bytes = args.max_size * 1024
        files = [p for p in files if p.stat().st_size < max_bytes]
    if args.skip_processed:
        files = [p for p in files if not (out_dir / p.name).exists()]
    if not files:
        print("未找到 DXF 文件")
        return 1
    print(f"共 {len(files)} 个文件, 输出目录: {out_dir}")
    ok = 0
    all_stats = []
    for f in files:
        result = process_file(f, out_dir)
        if result:
            ok += 1
            all_stats.append(result)
    print(f"完成: {ok}/{len(files)}")

    # 写入汇总日志
    if all_stats:
        summary_file = write_summary_log(all_stats, len(files), ok, LOG_DIR)
        print(f"汇总日志已保存: {summary_file}")

    return 0 if ok == len(files) else 2


if __name__ == "__main__":
    sys.exit(main())
