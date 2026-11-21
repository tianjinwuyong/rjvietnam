# -*- coding: utf-8 -*-
import sys
import os
import glob
import xlrd
import json
import re

bom_dir = r"C:\Users\tianj\Desktop\越南工厂瑞晶\越南工厂瑞晶\dc\bom"
files = sorted(glob.glob(os.path.join(bom_dir, "*.xls")))

results = []

for fpath in files:
    basename = os.path.basename(fpath)
    # Extract product code: SKU：B2672111-001 or 产品型号：EPS18R1G
    # Handle full-width colon (：) and regular colon
    product_code_match = re.search(r'(?:SKU[：:]\s*|产品型号[：:]\s*)([A-Z0-9]+-[A-Z0-9]+)', basename)
    if not product_code_match:
        product_code_match = re.search(r'([A-Z]{2,}\d{2,}[A-Z0-9-]+)', basename)
    product_code = product_code_match.group(1) if product_code_match else "UNKNOWN"
    if not os.path.exists(fpath):
        print(f"NOT FOUND: {fpath}", file=sys.stderr)
        continue

    print(f"Parsing: {os.path.basename(fpath).encode('ascii', 'replace').decode('ascii')}", file=sys.stderr)

    try:
        wb = xlrd.open_workbook(fpath, encoding_override="utf-8")
        # Find best sheet (prefer BOM, BOM表, 物料清单; fallback to largest sheet)
        bom_sheet = None
        best_sheet = None
        for sh in wb.sheets():
            if sh.name in ("BOM", "BOM表", "物料清单"):
                bom_sheet = sh
                break
            if best_sheet is None or sh.nrows * sh.ncols > best_sheet.nrows * best_sheet.ncols:
                best_sheet = sh
        if not bom_sheet:
            bom_sheet = best_sheet
        if not bom_sheet:
            print(f"  No BOM sheet found - using fallback sheet: {best_sheet.name if best_sheet else 'none'}", file=sys.stderr)
            continue

        # Read all rows
        all_rows = []
        for r in range(bom_sheet.nrows):
            row_data = []
            for c in range(bom_sheet.ncols):
                cell = bom_sheet.cell_value(r, c)
                row_data.append(str(cell).strip() if cell else "")
            all_rows.append(row_data)

        # Find header row (row with 物料编码 in col 1)
        header_row = None
        for i, row in enumerate(all_rows):
            if len(row) > 1 and ("物料编码" in row[1] or "物料代码" in row[1]):
                header_row = i
                break

        if header_row is None:
            print(f"  No header row found", file=sys.stderr)
            continue

        print(f"  Header at row {header_row}, cols: {bom_sheet.ncols}", file=sys.stderr)

        # Parse data rows
        lines = []
        seq = 1
        for i in range(header_row + 1, len(all_rows)):
            row = all_rows[i]
            # Cols: 0=seq, 1=materialCode, 2=category, 3=name, 4=spec, 5=unit, 6=qty, 7=position, 8=lossRate, 9=materialCode2, 10=nameZh
            if len(row) < 6:
                continue
            # Skip rows where materialCode col is empty or is a header label
            col1 = row[1].strip() if len(row) > 1 else ""
            if not col1 or col1 in ("物料编码", "序号"):
                continue

            # Parse qty - may be "1" or "1.0" or "0.03333"
            try:
                qty = float(row[6]) if len(row) > 6 and row[6] else 1.0
            except:
                qty = 1.0

            # Parse loss rate - may be "0" or "0.14" etc
            try:
                loss = float(row[8]) if len(row) > 8 and row[8] else 0.0
            except:
                loss = 0.0

            # Material name - col 3 (name) or col 10 (nameZh)
            name = row[3].strip() if len(row) > 3 else ""
            if not name:
                name = row[10].strip() if len(row) > 10 else col1

            # Spec - col 4
            spec = row[4].strip() if len(row) > 4 else ""

            # Position - col 7
            position = row[7].strip() if len(row) > 7 else ""

            # Unit - col 5
            unit = row[5].strip() if len(row) > 5 else "PCS"

            lines.append({
                "seq": seq,
                "materialCode": col1,
                "name": name,
                "spec": spec,
                "unit": unit,
                "qty": qty,
                "position": position,
                "lossRate": loss,
            })
            seq += 1

        # Find product name from title row (row 2 or 3)
        product_name = product_code
        for i in range(2, min(5, len(all_rows))):
            row = all_rows[i]
            for cell in row:
                if "A2672" in cell or "EPS" in cell:
                    # Try to extract product name
                    match = re.search(r'([A-Z]\d{4,}[A-Z0-9-]+)', cell)
                    if match:
                        product_name = match.group(1)
                    break
            if product_name != product_code:
                break

        results.append({
            "productCode": product_code,
            "productName": product_name,
            "lineCount": len(lines),
            "lines": lines[:5],  # Preview only
            "allLines": lines,
        })
        print(f"  Extracted {len(lines)} lines for {product_code}", file=sys.stderr)

    except Exception as e:
        print(f"ERROR processing {fpath}: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()

# Write preview (first 5 lines of each)
with open(r"C:\Users\tianj\Desktop\越南工厂瑞晶\越南工厂瑞晶\smt-factory-system\scripts\bom_import_preview.json", "w", encoding="utf-8") as f:
    preview = [{k: v for k, v in r.items() if k != "allLines"} for r in results]
    json.dump(preview, f, ensure_ascii=False, indent=2)
print("Preview written to bom_import_preview.json", file=sys.stderr)

# Write full data
for r in results:
    fname = f"bom_excel_{r['productCode']}.json"
    fpath = os.path.join(r"C:\Users\tianj\Desktop\越南工厂瑞晶\越南工厂瑞晶\smt-factory-system\scripts", fname)
    with open(fpath, "w", encoding="utf-8") as f:
        json.dump({"productCode": r["productCode"], "productName": r["productName"], "lines": r["allLines"]}, f, ensure_ascii=False, indent=2)
    print(f"Full data written to {fname}", file=sys.stderr)
