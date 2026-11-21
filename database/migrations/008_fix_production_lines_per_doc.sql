-- Fix production_lines to match 工单编码规则 document
-- Doc defines: 01=SMT线, 02=半自动线, 03=包装线, 04=手动线, 99=返工线

-- First update the existing misnamed lines (migration 007 added wrong names)
UPDATE production_lines
SET name_zh = 'SMT线', name_en = 'SMT Line', name_vi = 'Dây chuyền SMT'
WHERE numeric_line_code = '01';

UPDATE production_lines
SET name_zh = '半自动线', name_en = 'Semi-auto Line', name_vi = 'Dây chuyền bán tự động'
WHERE numeric_line_code = '02';

UPDATE production_lines
SET name_zh = '包装线', name_en = 'Packaging Line', name_vi = 'Dây chuyền đóng gói'
WHERE numeric_line_code = '03';

UPDATE production_lines
SET name_zh = '手动线', name_en = 'Manual Line', name_vi = 'Dây chuyền thủ công'
WHERE numeric_line_code = '04';

-- Add the rework line (code 99) used in the doc examples (26063990003)
INSERT INTO production_lines (internal_code, numeric_line_code, name_zh, name_en, name_vi, status)
VALUES ('L099', '99', '返工线', 'Rework Line', 'Dây chuyền sửa lỗi', 'idle')
ON CONFLICT (internal_code) DO NOTHING;
