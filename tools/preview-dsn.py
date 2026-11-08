"""
apply-dsn-factory.py 的预览模式：把每个文件的「改前 → 改后」打到 stdout，
不写盘。用于人工核对 options 插入位置与缩进是否正确。
"""
import importlib.util
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location(
    "apply_dsn_factory", os.path.join(_HERE, "apply-dsn-factory.py"))
A = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(A)

SAMPLES = [
    "services/api/server.js",
    "services/api/src/db.js",
    "services/_shared/db.js",
    "services/api/agv-api.js",
    "services/worker/wms-query.js",
    "services/worker/hr-execute.js",
    "wms/server/database/database.provider.ts",
]

for rel in SAMPLES:
    txt = A.read(rel)
    if txt is None:
        print(f"### {rel}  (NOT FOUND)")
        continue
    print("=" * 70)
    print(f"### {rel}")
    print("=" * 70)
    lines = txt.split("\n")
    for i, line in enumerate(lines):
        if "smt_factory" in line or "search_path" in line or "DB_NAME" in line:
            lo = max(0, i - 3)
            hi = min(len(lines), i + 4)
            for j in range(lo, hi):
                marker = ">>" if j == i else "  "
                print(f"{marker} {j+1:5d}| {lines[j]}")
            print("   ...")
    print()
