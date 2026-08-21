# -*- coding: utf-8 -*-
"""生成对齐测试图纸: 各对齐方式文字 + 中心标记线, 用于 viewer 实测"""
import ezdxf
from ezdxf.enums import TextEntityAlignment

doc = ezdxf.new("R2010")
doc.styles.add("宋体", font="simsun.ttf")
msp = doc.modelspace()

CX = 1000.0  # 中心线 x
msp.add_line((CX, 250), (CX, 560))  # 竖直中心标记

rows = [
    ("防 火 门", TextEntityAlignment.CENTER, 500),
    ("防爆密闭门", TextEntityAlignment.CENTER, 460),
    ("挡 风 墙 及 栅 栏", TextEntityAlignment.CENTER, 420),
    ("正中风门", TextEntityAlignment.MIDDLE, 380),
    ("右对齐风门", TextEntityAlignment.RIGHT, 340),
]
for content, align, y in rows:
    t = msp.add_text(content, dxfattribs={"style": "宋体", "height": 20.0, "width": 0.904})
    t.set_placement((CX - 60, y), align=align)   # insert 给个无关旧值, 对齐点在中心线上
    t.dxf.align_point = (CX, y, 0)

mt = msp.add_mtext("多行正中风门", dxfattribs={"style": "宋体", "char_height": 20.0})
mt.dxf.insert = (CX, 300, 0)
mt.dxf.attachment_point = 5

# 手工左对齐参照(模拟图例里本来就左对齐的"风门")
msp.add_text("手工左对齐", dxfattribs={"style": "宋体", "height": 20.0, "width": 0.904,
                                       "insert": (CX - 50, 270, 0)})

doc.saveas(r"cad-tools/tools/testdata/justify_test.dxf")
print("saved cad-tools/tools/testdata/justify_test.dxf")
