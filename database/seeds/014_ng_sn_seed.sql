-- ============================================================
-- NG Defect Codes & SN Duplicate Audit Seed Data
-- Covers all 32 MES station NG types + dup SN detection scenarios
-- ============================================================

-- ============================================================
-- 1. Comprehensive Defect Codes (30 codes covering all 32 stations)
-- ============================================================
insert into defect_codes (code, name_zh, name_en, name_vi, severity, defect_category) values
-- PCB/SMT defects
('PCB-SCRATCH', 'PCB板划伤', 'PCB Scratch', 'Vết xước PCB', 'major', 'pcb'),
('PCB-BREAK', 'PCB板断裂', 'PCB Break', 'Gãy PCB', 'critical', 'pcb'),
('SMT-MISSING', 'SMT贴装漏件', 'SMT Missing Component', 'Thiếu linh kiện SMT', 'critical', 'solder'),
('SMT-OFFSET', 'SMT贴装偏移', 'SMT Offset', 'Lệch vị trí SMT', 'major', 'solder'),
('SMT-TOMBSTONE', 'SMT立碑', 'SMT Tombstone', 'Đứng linh kiện SMT', 'major', 'solder'),
('SMT-SHORT', 'SMT桥连短路', 'SMT Solder Short', 'Chập mạch SMT', 'critical', 'solder'),
('SMT-OPEN', 'SMT开路', 'SMT Open Joint', 'Hở mạch SMT', 'critical', 'solder'),
('SMT-VOID', 'SMT气泡/空洞', 'SMT Void', 'Bọt khí SMT', 'minor', 'solder'),
('SMT-DAMAGE', 'SMT元件损坏', 'SMT Component Damage', 'Hư linh kiện SMT', 'major', 'assembly'),
('AOI-OPEN', 'AOI开路', 'AOI Open Joint', 'Hở mạch AOI', 'major', 'solder'),
('AOI-SHORT', 'AOI短路', 'AOI Solder Short', 'Chập mạch AOI', 'major', 'solder'),
('AOI-COMP', 'AOI元件缺陷', 'AOI Component Defect', 'Linh kiện lỗi AOI', 'major', 'assembly'),
('AOI-REFLOW', 'AOI回流异常', 'AOI Reflow Abnormal', 'Reflow bất thường AOI', 'minor', 'solder'),
-- Wave solder defects
('WAVE-SHORT', '波峰焊桥连', 'Wave Solder Short', 'Chập sóng hàn', 'critical', 'solder'),
('WAVE-OPEN', '波峰焊开路', 'Wave Solder Open', 'Hở sóng hàn', 'critical', 'solder'),
('WAVE-INSUFF', '波峰焊焊不足', 'Wave Insufficient Solder', 'Hàn không đủ', 'major', 'solder'),
('WAVE-EXCESS', '波峰焊焊过多', 'Wave Excess Solder', 'Hàn quá nhiều', 'minor', 'solder'),
('WAVE-DROSS', '波峰焊渣多', 'Wave Excess Dross', 'Xỉ nhiều', 'minor', 'process'),
-- Insertion defects
('INSERT-MISSING', '插件漏件', 'Missing Component', 'Thiếu linh kiện cắm', 'critical', 'assembly'),
('INSERT-POLARITY', '插件极性反', 'Wrong Polarity', 'Cắm ngược cực', 'critical', 'assembly'),
('INSERT-HEIGHT', '插件高度异常', 'Insertion Height Abnormal', 'Chiều cao cắm bất thường', 'major', 'assembly'),
-- AOI/VI inspection defects
('VI-DAMAGE', '目检外观破损', 'Visual Damage', 'Hư hỏng bề ngoài', 'major', 'cosmetic'),
('VI-SOLDER', '目检焊点不良', 'Visual Solder Defect', 'Mối hàn xấu', 'major', 'solder'),
('VI-CONTAM', '目检污染', 'Contamination', 'Nhiễm bẩn', 'minor', 'process'),
-- Test station defects
('ICT-FAIL', 'ICT测试失败', 'ICT Test Fail', 'ICT thất bại', 'major', 'test'),
('FCT-FAIL', 'FCT功能失败', 'FCT Function Fail', 'FCT chức năng thất bại', 'major', 'test'),
('HIPOT-FAIL', '耐压测试失败', 'Hi-pot Test Fail', 'Hi-pot thất bại', 'critical', 'test'),
('BURNIN-FAIL', '老化测试失败', 'Burn-in Test Fail', ' già hóa thất bại', 'major', 'test'),
-- Rework/Repair defects
('REWORK-REPEAT', '返工后重复不良', 'Repeat Defect After Rework', 'Lỗi lặp lại sau sửa', 'critical', 'repair'),
('DECODE-FAIL', '解码失败', 'Decoding Fail', 'Giải mã thất bại', 'major', 'process'),
-- Packing/OQC defects
('OQC-COSMETIC', 'OQC外观不良', 'OQC Cosmetic Defect', 'Ngoại hình OQC xấu', 'minor', 'cosmetic'),
('LABEL-ERROR', '标签错误', 'Label Error', 'Nhãn lỗi', 'minor', 'packing')
on conflict (code) do nothing;

-- ============================================================
-- 2. Demo NG Defect Records for current year (2026)
-- ============================================================
do $$
declare
  v_l001 bigint;
  v_station_laser bigint;
  v_station_aoi bigint;
  v_station_ict bigint;
  v_station_fct bigint;
  v_station_hi_pot bigint;
  v_station_burnin bigint;
  v_station_ultrasonic bigint;
  v_station_oqc bigint;
  v_dc_smt_missing bigint;
  v_dc_aoipen bigint;
  v_dc_fct bigint;
  v_dc_hipot bigint;
  v_dc_cosmetic bigint;
  v_op1 bigint;
begin
  -- resolve IDs
  select id into v_l001 from production_lines where internal_code = 'L001';
  select id into v_station_aoi from stations where line_id = v_l001 and code = 'AOI-01';
  select id into v_station_ict from stations where line_id = v_l001 and code = 'ICT-01';
  select id into v_station_fct from stations where line_id = v_l001 and code = 'FCT-01';
  select id into v_station_hi_pot from stations where line_id = v_l001 and code = 'HIPOT-01';
  select id into v_station_burnin from stations where line_id = v_l001 and code = 'BI-TEST-01';
  select id into v_station_ultrasonic from stations where line_id = v_l001 and code = 'ULTRA-01';
  select id into v_station_oqc from stations where line_id = v_l001 and code = 'PACK-01';

  select id into v_dc_smt_missing from defect_codes where code = 'SMT-MISSING';
  select id into v_dc_aoipen from defect_codes where code = 'AOI-OPEN';
  select id into v_dc_fct from defect_codes where code = 'FCT-FAIL';
  select id into v_dc_hipot from defect_codes where code = 'HIPOT-FAIL';
  select id into v_dc_cosmetic from defect_codes where code = 'OQC-COSMETIC';

  select id into v_op1 from users where username = 'VN_OP_001';

  -- Insert demo NG records (simplified ng_defect_records schema, migration 017)
  insert into ng_defect_records
    (line_name, station_code, sn, defect_code, defect_desc, result, operator, occurred_at)
  values
    ('L001', 'AOI-01', 'PCBA-RUIJ-260619-0001', 'SMT-MISSING', 'Missing chip resistor 0603 at position U12', 'ng', 'VN_OP_001', now() - interval '2 hours'),
    ('L001', 'AOI-01', 'PCBA-RUIJ-260619-0002', 'AOI-OPEN', 'Open joint at resistor R45, 0402 package', 'ng', 'VN_OP_001', now() - interval '1 hour'),
    ('L001', 'FCT-01', 'PCBA-RUIJ-260619-0003', 'FCT-FAIL', 'FCT function test failed: UART communication timeout', 'ng', 'VN_OP_001', now() - interval '30 minutes'),
    ('L001', 'HIPOT-01', 'PCBA-RUIJ-260619-0004', 'HIPOT-FAIL', 'Hi-pot test failed: leakage current 12mA exceeds 5mA limit', 'ng', 'VN_OP_001', now() - interval '15 minutes'),
    ('L001', 'PACK-01', 'PCBA-RUIJ-260619-0005', 'OQC-COSMETIC', 'Scratch mark on top enclosure, 3mm length', 'ng', 'VN_OP_001', now() - interval '5 minutes')
  on conflict do nothing;

end $$;

-- ============================================================
-- 3. Demo SN Duplicate Attempts (blocked attempts audit log)
-- ============================================================
do $$
declare
  v_l001 bigint;
  v_station_snbind bigint;
  v_station_fct bigint;
  v_station_oqc bigint;
  v_op1 bigint;
  v_existing_pcb bigint;
begin
  select id into v_l001 from production_lines where internal_code = 'L001';
  select id into v_station_snbind from stations where line_id = v_l001 and code = 'SN-BIND-01';
  select id into v_station_fct from stations where line_id = v_l001 and code = 'FCT-01';
  select id into v_station_oqc from stations where line_id = v_l001 and code = 'PACK-01';
  select id into v_op1 from users where username = 'VN_OP_001';
  select id into v_existing_pcb from pcb_serials where serial_no = 'PCBA-RUIJ-260619-0001';

  -- Simulate a blocked duplicate SN binding attempt (simplified schema, migration 017)
  insert into sn_duplicate_attempts
    (sn, action, station_code, line_name, decision, operator, attempted_at)
  values
    ('PCBA-RUIJ-260619-0001', 'bind', 'SN-BIND-01', 'L001', 'blocked', 'VN_OP_001', now() - interval '3 hours')
  on conflict do nothing;

  -- Simulate an allowed re-scan (same SN scanned at different station for tracking)
  insert into sn_duplicate_attempts
    (sn, action, station_code, line_name, decision, operator, attempted_at)
  values
    ('PCBA-RUIJ-260619-0001', 'scan_only', 'FCT-01', 'L001', 'allowed', 'VN_OP_001', now() - interval '1 hour')
  on conflict do nothing;

  -- Simulate an override by supervisor (allowed with reason)
  insert into sn_duplicate_attempts
    (sn, action, station_code, line_name, decision, operator, attempted_at)
  values
    ('PCBA-RUIJ-260619-9999', 'bind', 'PACK-01', 'L001', 'overridden', 'VN_OP_001', now() - interval '30 minutes')
  on conflict do nothing;

end $$;

-- ============================================================
-- 4. Demo PCB Serials (for SN tracking)
-- ============================================================
do $$
declare
  v_wo1 bigint;
begin
  select id into v_wo1 from work_orders where code = '26061010008';

  insert into pcb_serials (serial_no, work_order_id, status, created_at)
  values
    ('PCBA-RUIJ-260619-0001', v_wo1, 'wip', now() - interval '4 hours'),
    ('PCBA-RUIJ-260619-0002', v_wo1, 'wip', now() - interval '3 hours'),
    ('PCBA-RUIJ-260619-0003', v_wo1, 'wip', now() - interval '2 hours'),
    ('PCBA-RUIJ-260619-0004', v_wo1, 'passed', now() - interval '1 hour'),
    ('PCBA-RUIJ-260619-0005', v_wo1, 'scrapped', now() - interval '30 minutes')
  on conflict (serial_no) do nothing;

end $$;

-- ============================================================
-- 5. Demo Traceability Events (SN scan events)
-- ============================================================
do $$
declare
  v_pcb1 bigint;
  v_pcb2 bigint;
  v_pcb3 bigint;
  v_l001 bigint;
  v_st_ai bigint;
  v_st_print bigint;
  v_st_spi bigint;
  v_st_nxt1 bigint;
  v_st_reflow bigint;
  v_st_aoi bigint;
begin
  select id into v_l001 from production_lines where internal_code = 'L001';
  select id into v_pcb1 from pcb_serials where serial_no = 'PCBA-RUIJ-260619-0001';
  select id into v_pcb2 from pcb_serials where serial_no = 'PCBA-RUIJ-260619-0002';
  select id into v_pcb3 from pcb_serials where serial_no = 'PCBA-RUIJ-260619-0003';
  select id into v_st_ai from stations where line_id = v_l001 and code = 'AI1-01';
  select id into v_st_print from stations where line_id = v_l001 and code = 'PRINT-01';
  select id into v_st_spi from stations where line_id = v_l001 and code = 'SPI-01';
  select id into v_st_nxt1 from stations where line_id = v_l001 and code = 'NXT-01';
  select id into v_st_reflow from stations where line_id = v_l001 and code = 'REFLOW-01';
  select id into v_st_aoi from stations where line_id = v_l001 and code = 'AOI-01';

  insert into traceability_events
    (trace_key, event_type, reference_no, status, actor, event_payload, occurred_at, entity_type, entity_id)
  values
    ('PCBA-RUIJ-260619-0001', 'ai_insert', 'PCBA-RUIJ-260619-0001', 'active', 'VN_OP_001',
     '{"station": "AI1-01", "result": "pass", "components": 24}'::jsonb, now() - interval '3.8 hours', 'pcb_serial', v_pcb1),
    ('PCBA-RUIJ-260619-0001', 'smt_placement', 'PCBA-RUIJ-260619-0001', 'active', 'VN_OP_001',
     '{"station": "NXT-01", "result": "pass", "placed": 128}'::jsonb, now() - interval '3.5 hours', 'pcb_serial', v_pcb1),
    ('PCBA-RUIJ-260619-0001', 'aoi_inspection', 'PCBA-RUIJ-260619-0001', 'active', 'VN_OP_001',
     '{"station": "AOI-01", "result": "fail", "defects": ["SMT-MISSING at U12"]}'::jsonb, now() - interval '2 hours', 'pcb_serial', v_pcb1),
    ('PCBA-RUIJ-260619-0002', 'pcb_serial', 'PCBA-RUIJ-260619-0002', 'active', 'VN_OP_001',
     '{"station": "AI1-01", "result": "pass"}'::jsonb, now() - interval '3 hours', 'pcb_serial', v_pcb2),
    ('PCBA-RUIJ-260619-0003', 'pcb_serial', 'PCBA-RUIJ-260619-0003', 'active', 'VN_OP_001',
     '{"station": "AI1-01", "result": "pass"}'::jsonb, now() - interval '2 hours', 'pcb_serial', v_pcb3)
  on conflict do nothing;

end $$;

-- ============================================================
-- 6. Demo SN Binding Records
-- ============================================================
do $$
declare
  v_pcb1 bigint;
  v_pcb2 bigint;
  v_wo1 bigint;
  v_l001 bigint;
  v_st_snbind bigint;
  v_op1 bigint;
begin
  select id into v_l001 from production_lines where internal_code = 'L001';
  select id into v_pcb1 from pcb_serials where serial_no = 'PCBA-RUIJ-260619-0001';
  select id into v_pcb2 from pcb_serials where serial_no = 'PCBA-RUIJ-260619-0002';
  select id into v_wo1 from work_orders where code = '26061010008';
  select id into v_st_snbind from stations where line_id = v_l001 and code = 'SN-BIND-01';
  select id into v_op1 from users where username = 'VN_OP_001';

  insert into sn_binding_records (work_order_id, binding_type, sn_a, sn_b, station_id, operator_id, bound_at)
  values
    (v_wo1, 'pcba外壳', 'PCBA-RUIJ-260619-0001', 'ENC-RUIJ-260619-A001', v_st_snbind, v_op1, now() - interval '1 hour'),
    (v_wo1, 'pcba外壳', 'PCBA-RUIJ-260619-0002', 'ENC-RUIJ-260619-A002', v_st_snbind, v_op1, now() - interval '30 minutes')
  on conflict do nothing;

end $$;
