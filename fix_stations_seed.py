#!/usr/bin/env python3
"""Fix corrupted insert into stations statements in 001_demo_factory_seed.sql"""
import re

path = "database/seeds/001_demo_factory_seed.sql"
with open(path, encoding="utf-8") as f:
    content = f.read()

# Pattern: corrupted lines
# Line pattern 1 (col):  &(line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
# Line pattern 2 (sel):  select l.id, 'XXX-01', st.id, '...', '...', '...', 'XXX-01', 'running'
# Line pattern 3 (whr):  & l.internal_code = 'L001' and st.code = 'pcb_laser';

lines = content.split('\n')
fixed = []
i = 0
while i < len(lines):
    line = lines[i]
    # Detect corrupted station insert column line
    if line.startswith("&(line_id, code, station_type_id"):
        col_line = line
        sel_line = lines[i+1] if i+1 < len(lines) else ""
        whr_line = lines[i+2] if i+2 < len(lines) else ""
        i += 3

        # Extract parts
        # sel_line: "select l.id, 'LASER-01', st.id, 'PCB镭码 1号', 'PCB Laser Marking 1', 'Khắc laser PCB 1', 'LASER-01', 'running'"
        sel_match = re.match(r"select (.+)$", sel_line)
        if not sel_match:
            fixed.append(col_line); fixed.append(sel_line); fixed.append(whr_line); i = 0; break
        sel_parts = sel_match.group(1)  # "l.id, 'LASER-01', st.id, 'PCB镭码 1号', ..."

        # whr_line: "& l.internal_code = 'L001' and st.code = 'pcb_laser';"
        whr_clean = whr_line.lstrip("&").strip()  # "l.internal_code = 'L001' and st.code = 'pcb_laser';"
        # Remove trailing ;
        whr_clean = whr_clean.rstrip(";").strip()

        # Extract internal_code and station_code
        m_int = re.search(r"l\.internal_code\s*=\s*'([^']+)'", whr_clean)
        m_stc = re.search(r"st\.code\s*=\s*'([^']+)'", whr_clean)
        int_code = m_int.group(1) if m_int else "L001"
        st_code = m_stc.group(1) if m_stc else "unknown"

        # sel_parts format: l.id, 'CODE', st.id, 'name_zh', 'name_en', 'name_vi', 'equip', 'status'
        # We want to reconstruct as INSERT ... SELECT ... FROM ... WHERE
        # Pattern from original: select l.id, 'LASER-01', st.id, 'PCB镭码 1号', 'PCB Laser Marking 1', 'Khắc laser PCB 1', 'LASER-01', 'running'
        # from production_lines l, station_types st where l.internal_code = 'L001' and st.code = 'pcb_laser'
        sql = (
            "insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)\n"
            "select l.id, " + sel_parts + "\n"
            "from production_lines l, station_types st\n"
            "where l.internal_code = '" + int_code + "' and st.code = '" + st_code + "'\n"
            "ON CONFLICT (line_id, code) DO NOTHING;"
        )
        fixed.append(sql)
    else:
        fixed.append(line)
        i += 1

if i == 0:  # patch succeeded
    with open(path, "w", encoding="utf-8") as f:
        f.write('\n'.join(fixed))
    count = sum(1 for l in fixed if l.startswith("insert into stations"))
    print("Fixed", count, "station inserts")
else:
    print("Loop exit with i=", i)
