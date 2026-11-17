# -*- coding: utf-8 -*-
import sys
import os
import xlrd

files = [
    r"C:\Users\tianj\Desktop\越南工厂瑞晶\越南工厂瑞晶\dc\bom\Anker A2672 CD版 1C 100WGaN插墙式电源适配器黑色（US版) SKU：B2672111-001  Vietnam版 2026.5.19 越南东泰.xls",
    r"C:\Users\tianj\Desktop\越南工厂瑞晶\越南工厂瑞晶\dc\bom\NBT 12V1.5A美规插墙式电源适配器冷灰色 产品型号：EPS18R1G AI版 Vietnam版 试产BOM 2023.05.23.xls",
]

for fpath in files:
    if not os.path.exists(fpath):
        print(f"NOT FOUND: {fpath}")
        continue
    print(f"\n=== FILE: {os.path.basename(fpath)} ===")
    try:
        wb = xlrd.open_workbook(fpath)
        for sh in wb.sheets():
            print(f"--- Sheet: {sh.name} ({sh.nrows} rows x {sh.ncols} cols) ---")
            # Print first 10 rows
            for r in range(min(sh.nrows, 10)):
                row = [str(sh.cell_value(r, c)).strip() for c in range(sh.ncols)]
                non_empty = [v for v in row if v]
                if non_empty:
                    print("  | " + " | ".join(non_empty))
    except Exception as e:
        print(f"ERROR: {e}")
