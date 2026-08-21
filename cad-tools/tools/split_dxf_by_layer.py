# -*- coding: utf-8 -*-
"""
按图层打散 DXF 图纸:将每个 DXF 文件按模型空间实体所在图层,
拆分为每图层一个独立 DXF 文件(块参照随实体一并导入,保留原始图形)。

用法:
    py cad/tools/split_dxf_by_layer.py [输入目录=cad/dxf] [输出目录=cad/dxf_split]

输出结构:
    输出目录/<图纸名>/<图层名>.dxf
"""
import re
import sys
import time
from pathlib import Path

import ezdxf
from ezdxf.addons import Importer

# Windows 文件名非法字符
INVALID_CHARS = re.compile(r'[\\/:*?"<>|]')


def safe_filename(name: str) -> str:
    s = INVALID_CHARS.sub("_", name).strip().strip(".")
    return s or "unnamed"


def read_doc(path: Path):
    try:
        return ezdxf.readfile(str(path))
    except Exception as e:
        print(f"  标准读取失败({e}),尝试 recover 模式...")
        from ezdxf import recover
        doc, _auditor = recover.readfile(str(path))
        return doc


def split_file(src: Path, out_root: Path) -> None:
    print(f"\n=== {src.name} ({src.stat().st_size / 1024 / 1024:.1f} MB) ===")
    t0 = time.time()
    doc = read_doc(src)
    print(f"  读取耗时 {time.time() - t0:.1f}s,DXF 版本 {doc.dxfversion}")

    # 按图层分组模型空间实体
    by_layer: dict[str, list] = {}
    for e in doc.modelspace():
        by_layer.setdefault(e.dxf.layer, []).append(e)

    # Windows 不允许目录名以空格/点结尾
    out_dir = out_root / src.stem.strip().strip(".")
    out_dir.mkdir(parents=True, exist_ok=True)

    insunits = doc.header.get("$INSUNITS", 0)
    used_names: set[str] = set()

    for layer_name in sorted(by_layer):
        entities = by_layer[layer_name]
        new_doc = ezdxf.new(dxfversion=doc.dxfversion, setup=True)
        try:
            new_doc.header["$INSUNITS"] = insunits
        except Exception:
            pass

        importer = Importer(doc, new_doc)
        importer.import_entities(entities, new_doc.modelspace())
        importer.finalize()

        fname = safe_filename(layer_name)
        # 图层名规范化后重名时加序号
        n = 1
        base = fname
        while fname.lower() in used_names:
            n += 1
            fname = f"{base}_{n}"
        used_names.add(fname.lower())

        out_path = out_dir / f"{fname}.dxf"
        new_doc.saveas(str(out_path))
        print(f"  [{len(entities):6d} 实体] {layer_name!r} -> {out_path.name}")

    print(f"  完成,共 {len(by_layer)} 个图层,总耗时 {time.time() - t0:.1f}s")


def main() -> None:
    in_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("cad/dxf")
    out_root = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("cad/dxf_split")

    files = sorted(in_dir.glob("*.dxf"))
    if not files:
        print(f"未在 {in_dir} 找到 DXF 文件")
        sys.exit(1)

    print(f"输入目录: {in_dir.resolve()}")
    print(f"输出目录: {out_root.resolve()}")
    print(f"共 {len(files)} 个文件")

    for src in files:
        try:
            split_file(src, out_root)
        except Exception as e:
            print(f"  !! 处理 {src.name} 失败: {e}")


if __name__ == "__main__":
    main()
