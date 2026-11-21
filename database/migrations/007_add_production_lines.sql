-- Add missing production lines per 工单编码规则
-- L002: AI产线 (AI Line)
-- L003: 装配产线 (Assembly Line)
-- L004: 返修产线 (Rework Line)
INSERT INTO production_lines (internal_code, numeric_line_code, name_zh, name_en, name_vi, status)
VALUES
  ('L002', '02', 'AI产线', 'AI Line', 'Dây chuyền AI', 'idle'),
  ('L003', '03', '装配产线', 'Assembly Line', 'Dây chuyền lắp ráp', 'idle'),
  ('L004', '04', '返修产线', 'Rework Line', 'Dây chuyền sửa lỗi', 'idle')
ON CONFLICT (internal_code) DO NOTHING;
