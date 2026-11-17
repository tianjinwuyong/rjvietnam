-- ============================================================
-- Factory Seed Data
-- All production lines, stations, machines, and master data
-- ============================================================

insert into roles (code, name_zh, name_en, name_vi) values
('management', '管理层', 'Management', 'Quản lý'),
('pmc', 'PMC 计划', 'PMC Planning', 'Kế hoạch PMC'),
('warehouse', '仓库', 'Warehouse', 'Kho'),
('quality', '质量', 'Quality', 'Chất lượng'),
('smt_operator', 'SMT 操作员', 'SMT Operator', 'Nhân viên SMT'),
('engineering', '工程部', 'Engineering', 'Kỹ sư'),
('oqc', 'OQC 检验', 'OQC Inspector', 'Nhân viên OQC'),
('rework', '维修技术员', 'Rework Technician', 'Kỹ thuật sửa lỗi'),
('customer_service', '客服', 'Customer Service', 'Chăm sóc khách hàng'),
('admin', '系统管理员', 'Administrator', 'Quản trị hệ thống')
on conflict (code) do nothing;

insert into users (username, display_name, role_id, locale)
select 'VN_OP_001', 'Nguyen Van A', id, 'vi-VN' from roles where code = 'smt_operator'
on conflict (username) do nothing;
insert into users (username, display_name, role_id, locale)
select 'VN_OP_002', 'Tran Thi B', id, 'vi-VN' from roles where code = 'smt_operator'
on conflict (username) do nothing;
insert into users (username, display_name, role_id, locale)
select 'VN_WH_001', 'Le Van C', id, 'vi-VN' from roles where code = 'warehouse'
on conflict (username) do nothing;
insert into users (username, display_name, role_id, locale)
select 'PMC_CN_01', 'Zhang Wei', id, 'zh-CN' from roles where code = 'pmc'
on conflict (username) do nothing;
insert into users (username, display_name, role_id, locale)
select 'QC_VN_01', 'Nguyen QC', id, 'vi-VN' from roles where code = 'quality'
on conflict (username) do nothing;
insert into users (username, display_name, role_id, locale)
select 'OQC_001', 'OQC Inspector 01', id, 'vi-VN' from roles where code = 'oqc'
on conflict (username) do nothing;
insert into users (username, display_name, role_id, locale)
select 'RW_001', 'Rework Tech 01', id, 'vi-VN' from roles where code = 'rework'
on conflict (username) do nothing;

-- Additional users referenced by 002_mvp_extended_seed.sql and 004_enterprise_support_seed.sql
insert into users (username, display_name, role_id, locale)
select 'VN_WH_010', 'Pham Van K', id, 'vi-VN' from roles where code = 'warehouse'
on conflict (username) do nothing;
insert into users (username, display_name, role_id, locale)
select 'VN_OP_013', 'Tran Thi C', id, 'vi-VN' from roles where code = 'smt_operator'
on conflict (username) do nothing;

-- Admin user (for org chart and HR management)
insert into users (username, display_name, role_id, locale)
select 'admin', 'System Administrator', id, 'zh-CN' from roles where code = 'admin'
on conflict (username) do nothing;

-- Additional materials
-- ============================================================
insert into materials (code, name_zh, name_en, name_vi, uom, material_type)
values ('C-0805-100NF', '贴片电容 0805 100nF', 'Chip capacitor 0805 100nF', 'Tụ góp 0805 100nF', 'PCS', 'component')
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- Storage Locations
-- ============================================================
insert into station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software) values
('ai_insert_1', 'AI插件机 1号', 'AI Insertion 1', 'Máy cắm AI 1', 'production', true, true),
('ai_insert_2', 'AI插件机 2号', 'AI Insertion 2', 'Máy cắm AI 2', 'production', true, true),
('smt_mounter_1', '贴片机 1号', 'SMT Mounter 1', 'Máy đặt linh kiện 1', 'production', true, true),
('smt_mounter_2', '贴片机 2号', 'SMT Mounter 2', 'Máy đặt linh kiện 2', 'production', true, true),
('smt_aoi', 'SMT-AOI', 'SMT AOI Inspection', 'AOI SMT', 'production', true, true),
('pcba_loading', 'PCBA上料', 'PCBA Loading', 'Lắp ráp PCBA', 'production', false, true),
('pda_scan', 'PDA上料扫描', 'PDA Scan Loading', 'Quét PDA', 'production', true, false),
('wsaoi', 'WS-AOI', 'Wave Solder AOI', 'AOI sóng hàn', 'production', true, true),
('ict', 'ICT测试', 'ICT Test', 'Kiểm tra ICT', 'production', true, true),
('fct', 'FCT测试', 'FCT Test', 'Kiểm tra FCT', 'production', true, true),
('depanel', '分板', 'Board Depaneling', 'Tách panel', 'production', true, true),
('sn_bind_pcba', '绑码 PCBA_Link', 'PCBA SN Binding', 'Gán mã PCBA', 'production', false, true),
('ate_1', 'ATE1 半成品测试', 'ATE1 Test', 'Kiểm tra ATE1', 'production', true, true),
('ultrasonic', '超声焊接', 'Ultrasonic Welding', 'Hàn siêu âm', 'production', true, true),
('burnin_load', '老化上机', 'Burn-in Loading', 'Lắp老化', 'production', true, true),
('burnin_test', '老化测试', 'Burn-in Test', 'Kiểm tra老化', 'production', true, true),
('hipot', '高压测试', 'Hi-pot Test', 'Kiểm tra cao áp', 'production', true, true),
('ate_2', 'ATE2 成品测试', 'ATE2 Test', 'Kiểm tra ATE2', 'production', true, true),
('sn_bind_code', '绑码 CODE-LINK', 'Code SN Binding', 'Gán mã CODE', 'production', false, true),
('packing', '包装', 'Packing', 'Đóng gói', 'production', false, true),
('pallet_label', '栈板标签', 'Pallet Labeling', 'Nhãn pallet', 'production', false, true),
('appearance_defect', '外观不良上传', 'Appearance Defect Upload', 'Tải lên khuyết tật', 'production', false, true),
('oqc_hipot', 'OQC 高压测试', 'OQC Hi-pot', 'OQC cao áp', 'oqc', true, true),
('oqc_ate', 'OQC ATE测试', 'OQC ATE Test', 'OQC kiểm tra ATE', 'oqc', true, true),
('oqc_cosmetic', 'OQC 外观检验', 'OQC Cosmetic', 'OQC kiểm tra ngoại hình', 'oqc', false, true),
('defect_replacement', '不良品替换', 'Defect Replacement', 'Thay thế khuyết tật', 'oqc', false, true),
('oqc_report', 'OQC 报表记录', 'OQC Report', 'Báo cáo OQC', 'oqc', false, true),
('barcode_convert', '条码转换', 'Barcode Conversion', 'Chuyển đổi mã vạch', 'production', false, true),
('decoding', '解码', 'Decoding', 'Giải mã', 'production', false, true),
('msd_baking', 'PCBA 烘烤', 'MSD Baking', 'Nướng MSĐ', 'production', true, true),
('repair_report', '维修报表', 'Repair Report', 'Báo cáo sửa chữa', 'repair', false, true)
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- Production Lines
-- ============================================================
insert into production_lines (internal_code, numeric_line_code, name_zh, name_en, name_vi, status)
values
  ('L001', '01', 'SMT 产线', 'SMT Line 1', 'Dây chuyền SMT 1', 'running'),
  ('L002', '02', 'SMT 产线 2', 'SMT Line 2', 'Dây chuyền SMT 2', 'idle'),
  ('L003', '03', '组装产线', 'Assembly Line', 'Dây chuyền lắp ráp', 'idle'),
  ('L004', '04', '包装产线', 'Packing Line', 'Dây chuyền đóng gói', 'idle'),
  ('L099', '99', '返工维修线', 'Rework & Repair Line', 'Dây chuyền sửa chữa', 'idle')
on conflict (internal_code) do nothing;

-- ============================================================
-- Machines (Equipment Registry)
-- ============================================================
-- L001 SMT Line 1 equipment
insert into machines (line_id, code, machine_type, brand, model, status)
select id, 'AI1-01', 'ai_insert', '中禾旭', 'HS-K6S', 'ready' from production_lines where internal_code = 'L001'
on conflict (code) do nothing;
insert into machines (line_id, code, machine_type, brand, model, status)
select id, 'PRINT-01', 'printer', 'GKG', 'GSK', 'ready' from production_lines where internal_code = 'L001'
on conflict (code) do nothing;
insert into machines (line_id, code, machine_type, brand, model, status)
select id, 'PRINT-02', 'printer', 'GKG', 'GSK', 'ready' from production_lines where internal_code = 'L001'
on conflict (code) do nothing;
insert into machines (line_id, code, machine_type, brand, model, status)
select id, 'SPI-01', 'SPI', '镭晨', 'AIS631MB-HW', 'ready' from production_lines where internal_code = 'L001'
on conflict (code) do nothing;
insert into machines (line_id, code, machine_type, brand, model, status)
select id, 'NXT-01', 'mounter', '松下', 'NPM-D3A', 'ready' from production_lines where internal_code = 'L001'
on conflict (code) do nothing;
insert into machines (line_id, code, machine_type, brand, model, status)
select id, 'NXT-02', 'mounter', '松下', 'NPM-D3A', 'ready' from production_lines where internal_code = 'L001'
on conflict (code) do nothing;
insert into machines (line_id, code, machine_type, brand, model, status)
select id, 'NXT-03', 'mounter', '松下', 'NPM-D3A', 'ready' from production_lines where internal_code = 'L001'
on conflict (code) do nothing;
insert into machines (line_id, code, machine_type, brand, model, serial_no, status)
select id, 'REFLOW-01', 'reflow', '劲拓', 'JTR-1000D', '1120-2512-226', 'ready' from production_lines where internal_code = 'L001'
on conflict (code) do nothing;
insert into machines (line_id, code, machine_type, brand, model, status)
select id, 'AOI-01', 'AOI', '镭晨', 'AIS430-D', 'ready' from production_lines where internal_code = 'L001'
on conflict (code) do nothing;
insert into machines (line_id, code, machine_type, brand, model, status)
select id, 'PDA-01', 'PDA', null, null, 'ready' from production_lines where internal_code = 'L001'
on conflict (code) do nothing;
insert into machines (line_id, code, machine_type, brand, model, status)
select id, 'WS-AOI-01', 'WS-AOI', '富源科', 'AIVS-DI510', 'ready' from production_lines where internal_code = 'L001'
on conflict (code) do nothing;
insert into machines (line_id, code, machine_type, brand, model, serial_no, status)
select id, 'ICT-01', 'ICT', '富源科', 'FYK-CS-801', 'FYK-CS-20260305-005', 'ready' from production_lines where internal_code = 'L001'
on conflict (code) do nothing;
insert into machines (line_id, code, machine_type, brand, model, serial_no, status)
select id, 'FCT-01', 'FCT', '富源科', 'FYK-CS-432', 'FYK-CS-20260305-006', 'ready' from production_lines where internal_code = 'L001'
on conflict (code) do nothing;
insert into machines (line_id, code, machine_type, brand, model, serial_no, status)
select id, 'DEPANEL-01', 'depanel', '富源科', 'EXE880AT', 'E-M010101-00015', 'ready' from production_lines where internal_code = 'L001'
on conflict (code) do nothing;
insert into machines (line_id, code, machine_type, brand, model, status)
select id, 'ATE1-01', 'ATE', '安拓森', null, 'ready' from production_lines where internal_code = 'L001'
on conflict (code) do nothing;
insert into machines (line_id, code, machine_type, brand, model, serial_no, status)
select id, 'ULTRA-01', 'ultrasonic', '富源科', 'FYK-CS-701', 'FYK-CS-20260305-011', 'ready' from production_lines where internal_code = 'L001'
on conflict (code) do nothing;
insert into machines (line_id, code, machine_type, brand, model, serial_no, status)
select id, 'BI-LOAD-01', 'burnin', '创华', 'CHZN-1200S', 'CHZN2026020501', 'ready' from production_lines where internal_code = 'L001'
on conflict (code) do nothing;
insert into machines (line_id, code, machine_type, brand, model, status)
select id, 'HIPOT-01', 'hipot', '安拓森', null, 'ready' from production_lines where internal_code = 'L001'
on conflict (code) do nothing;
insert into machines (line_id, code, machine_type, brand, model, status)
select id, 'ATE2-01', 'ATE', '安拓森', null, 'ready' from production_lines where internal_code = 'L001'
on conflict (code) do nothing;

-- L002 SMT Line 2 equipment
insert into machines (line_id, code, machine_type, brand, model, status)
select id, 'AI2-01', 'ai_insert', '中禾旭', 'HS-K6S', 'ready' from production_lines where internal_code = 'L002'
on conflict (code) do nothing;
insert into machines (line_id, code, machine_type, brand, model, status)
select id, 'PRINT-03', 'printer', 'GKG', 'GSK', 'ready' from production_lines where internal_code = 'L002'
on conflict (code) do nothing;
insert into machines (line_id, code, machine_type, brand, model, status)
select id, 'SPI-02', 'SPI', '镭晨', 'AIS631MB-HW', 'ready' from production_lines where internal_code = 'L002'
on conflict (code) do nothing;
insert into machines (line_id, code, machine_type, brand, model, status)
select id, 'NXT-04', 'mounter', '松下', 'NPM-D3A', 'ready' from production_lines where internal_code = 'L002'
on conflict (code) do nothing;
insert into machines (line_id, code, machine_type, brand, model, status)
select id, 'NXT-05', 'mounter', '松下', 'NPM-D3A', 'ready' from production_lines where internal_code = 'L002'
on conflict (code) do nothing;
insert into machines (line_id, code, machine_type, brand, model, status)
select id, 'NXT-06', 'mounter', '松下', 'NPM-D3A', 'ready' from production_lines where internal_code = 'L002'
on conflict (code) do nothing;
insert into machines (line_id, code, machine_type, brand, model, status)
select id, 'REFLOW-02', 'reflow', '劲拓', 'JTR-1000D', 'ready' from production_lines where internal_code = 'L002'
on conflict (code) do nothing;
insert into machines (line_id, code, machine_type, brand, model, status)
select id, 'AOI-02', 'AOI', '镭晨', 'AIS430-D', 'ready' from production_lines where internal_code = 'L002'
on conflict (code) do nothing;
insert into machines (line_id, code, machine_type, brand, model, status)
select id, 'PDA-02', 'PDA', null, null, 'ready' from production_lines where internal_code = 'L002'
on conflict (code) do nothing;
insert into machines (line_id, code, machine_type, brand, model, status)
select id, 'WS-AOI-02', 'WS-AOI', '富源科', 'AIVS-DI510', 'ready' from production_lines where internal_code = 'L002'
on conflict (code) do nothing;
insert into machines (line_id, code, machine_type, brand, model, serial_no, status)
select id, 'ICT-02', 'ICT', '泰视特测', 'SRC8001', '100122261', 'ready' from production_lines where internal_code = 'L002'
on conflict (code) do nothing;
insert into machines (line_id, code, machine_type, brand, model, status)
select id, 'FCT-02', 'FCT', null, null, 'ready' from production_lines where internal_code = 'L002'
on conflict (code) do nothing;
insert into machines (line_id, code, machine_type, brand, model, status)
select id, 'DEPANEL-02', 'depanel', '富源科', 'EXE880', 'ready' from production_lines where internal_code = 'L002'
on conflict (code) do nothing;
insert into machines (line_id, code, machine_type, brand, model, status)
select id, 'ATE1-02', 'ATE', '安拓森', null, 'ready' from production_lines where internal_code = 'L002'
on conflict (code) do nothing;
insert into machines (line_id, code, machine_type, brand, model, status)
select id, 'ULTRA-02', 'ultrasonic', '富源科', 'FYK-CS-701', 'ready' from production_lines where internal_code = 'L002'
on conflict (code) do nothing;
insert into machines (line_id, code, machine_type, brand, model, status)
select id, 'BI-LOAD-02', 'burnin', '安拓森', null, 'ready' from production_lines where internal_code = 'L002'
on conflict (code) do nothing;
insert into machines (line_id, code, machine_type, brand, model, status)
select id, 'HIPOT-02', 'hipot', '安拓森', null, 'ready' from production_lines where internal_code = 'L002'
on conflict (code) do nothing;
insert into machines (line_id, code, machine_type, brand, model, status)
select id, 'ATE2-02', 'ATE', '安拓森', null, 'ready' from production_lines where internal_code = 'L002'
on conflict (code) do nothing;

-- L003 Assembly Line equipment
insert into machines (line_id, code, machine_type, brand, model, status)
select id, 'AI-TH-01', 'ai_insert', 'JUKI', 'JM-100', 'ready' from production_lines where internal_code = 'L003'
on conflict (code) do nothing;
insert into machines (line_id, code, machine_type, brand, model, status)
select id, 'DJ-ASM-01', 'dispenser', '富源科', 'FYK-DJ-101', 'ready' from production_lines where internal_code = 'L003'
on conflict (code) do nothing;
insert into machines (line_id, code, machine_type, brand, model, status)
select id, 'WAVE-01', 'wave_solder', '中禾旭', 'ZKS-3B', 'ready' from production_lines where internal_code = 'L003'
on conflict (code) do nothing;
insert into machines (line_id, code, machine_type, brand, model, status)
select id, 'WS-AOI-03', 'WS-AOI', '富源科', 'AIVS-DI510', 'ready' from production_lines where internal_code = 'L003'
on conflict (code) do nothing;
insert into machines (line_id, code, machine_type, brand, model, status)
select id, 'ATE1-03', 'ATE', '安拓森', null, 'ready' from production_lines where internal_code = 'L003'
on conflict (code) do nothing;
insert into machines (line_id, code, machine_type, brand, model, status)
select id, 'ULTRA-03', 'ultrasonic', '富源科', 'FYK-CS-701', 'ready' from production_lines where internal_code = 'L003'
on conflict (code) do nothing;
insert into machines (line_id, code, machine_type, brand, model, status)
select id, 'BI-ASM-01', 'burnin', '安拓森', null, 'ready' from production_lines where internal_code = 'L003'
on conflict (code) do nothing;
insert into machines (line_id, code, machine_type, brand, model, status)
select id, 'HIPOT-03', 'hipot', '安拓森', null, 'ready' from production_lines where internal_code = 'L003'
on conflict (code) do nothing;
insert into machines (line_id, code, machine_type, brand, model, status)
select id, 'ATE2-03', 'ATE', '安拓森', null, 'ready' from production_lines where internal_code = 'L003'
on conflict (code) do nothing;

-- L004 Packing Line equipment
insert into machines (line_id, code, machine_type, brand, model, status)
select id, 'LABEL-01', 'label_printer', null, null, 'ready' from production_lines where internal_code = 'L004'
on conflict (code) do nothing;
insert into machines (line_id, code, machine_type, brand, model, status)
select id, 'NAMEPLATE-01', 'nameplate', '中能达', null, 'ready' from production_lines where internal_code = 'L004'
on conflict (code) do nothing;
insert into machines (line_id, code, machine_type, brand, model, status)
select id, 'NAMEPLATE-02', 'nameplate', '中能达', null, 'ready' from production_lines where internal_code = 'L004'
on conflict (code) do nothing;
insert into machines (line_id, code, machine_type, brand, model, status)
select id, 'PACK-SCAN-01', 'pack_scan', null, null, 'ready' from production_lines where internal_code = 'L004'
on conflict (code) do nothing;
insert into machines (line_id, code, machine_type, brand, model, status)
select id, 'PACK-SCAN-02', 'pack_scan', null, null, 'ready' from production_lines where internal_code = 'L004'
on conflict (code) do nothing;
insert into machines (line_id, code, machine_type, brand, model, status)
select id, 'OQC-HIPOT-01', 'hipot', '安拓森', null, 'ready' from production_lines where internal_code = 'L004'
on conflict (code) do nothing;
insert into machines (line_id, code, machine_type, brand, model, status)
select id, 'OQC-ATE-01', 'ATE', '安拓森', null, 'ready' from production_lines where internal_code = 'L004'
on conflict (code) do nothing;
insert into machines (line_id, code, machine_type, brand, model, status)
select id, 'OQC-ATE-02', 'ATE', '安拓森', null, 'ready' from production_lines where internal_code = 'L004'
on conflict (code) do nothing;

-- L099 Rework Line equipment
insert into machines (line_id, code, machine_type, brand, model, status)
select id, 'RW-ST-01', 'rework_station', null, null, 'ready' from production_lines where internal_code = 'L099'
on conflict (code) do nothing;
insert into machines (line_id, code, machine_type, brand, model, status)
select id, 'RW-HOTAIR-01', 'hot_air_gun', null, null, 'ready' from production_lines where internal_code = 'L099'
on conflict (code) do nothing;
insert into machines (line_id, code, machine_type, brand, model, status)
select id, 'RW-SOLDER-01', 'soldering_iron', null, null, 'ready' from production_lines where internal_code = 'L099'
on conflict (code) do nothing;
insert into machines (line_id, code, machine_type, brand, model, status)
select id, 'RW-OVEN-01', 'baking_oven', null, null, 'ready' from production_lines where internal_code = 'L099'
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- Stations for all production lines
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'AI1-01', st.id, 'AI插件机 1号', 'AI Insertion 1', 'Máy cắm AI 1', 'AI1-01', 'running'
from production_lines l, station_types st
where l.internal_code = 'L001' and st.code = 'ai_insert_1'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'PRINT-01', st.id, '锡膏印刷 1号', 'Solder Paste Printer 1', 'Máy in kem 1', 'PRINT-01', 'running'
from production_lines l, station_types st
where l.internal_code = 'L001' and st.code = 'smt_mounter_1'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'SPI-01', st.id, 'SPI 锡膏检测', 'SPI Inspection', 'Kiểm tra SPI', 'SPI-01', 'running'
from production_lines l, station_types st
where l.internal_code = 'L001' and st.code = 'smt_mounter_1'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'NXT-01', st.id, '贴片机 1号', 'SMT Mounter 1', 'Máy đặt 1', 'NXT-01', 'running'
from production_lines l, station_types st
where l.internal_code = 'L001' and st.code = 'smt_mounter_1'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'NXT-02', st.id, '贴片机 2号', 'SMT Mounter 2', 'Máy đặt 2', 'NXT-02', 'running'
from production_lines l, station_types st
where l.internal_code = 'L001' and st.code = 'smt_mounter_2'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'NXT-03', st.id, '贴片机 3号', 'SMT Mounter 3', 'Máy đặt 3', 'NXT-03', 'running'
from production_lines l, station_types st
where l.internal_code = 'L001' and st.code = 'smt_mounter_2'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'REFLOW-01', st.id, '回流焊', 'Reflow Oven', 'Lò hồ quang', 'REFLOW-01', 'running'
from production_lines l, station_types st
where l.internal_code = 'L001' and st.code = 'smt_aoi'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'AOI-01', st.id, 'SMT-AOI 检测', 'SMT AOI Inspection', 'AOI SMT', 'AOI-01', 'running'
from production_lines l, station_types st
where l.internal_code = 'L001' and st.code = 'smt_aoi'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'PCBA-LOAD', st.id, 'PCBA上料', 'PCBA Loading', 'Lắp PCBA', null, 'running'
from production_lines l, station_types st
where l.internal_code = 'L001' and st.code = 'pcba_loading'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'PDA-01', st.id, 'PDA 上料扫描', 'PDA Scan Loading', 'Quét PDA', 'PDA-01', 'running'
from production_lines l, station_types st
where l.internal_code = 'L001' and st.code = 'pda_scan'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'WS-AOI-01', st.id, 'WS-AOI 检测', 'Wave Solder AOI', 'AOI sóng hàn', 'WS-AOI-01', 'running'
from production_lines l, station_types st
where l.internal_code = 'L001' and st.code = 'wsaoi'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'ICT-01', st.id, 'ICT 测试', 'ICT Test', 'Kiểm tra ICT', 'ICT-01', 'running'
from production_lines l, station_types st
where l.internal_code = 'L001' and st.code = 'ict'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'FCT-01', st.id, 'FCT 测试', 'FCT Test', 'Kiểm tra FCT', 'FCT-01', 'running'
from production_lines l, station_types st
where l.internal_code = 'L001' and st.code = 'fct'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'DEPANEL-01', st.id, '分板', 'Board Depaneling', 'Tách panel', 'DEPANEL-01', 'running'
from production_lines l, station_types st
where l.internal_code = 'L001' and st.code = 'depanel'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'SN-BIND-01', st.id, '绑码 PCBA_Link', 'PCBA SN Binding', 'Gán mã PCBA', null, 'running'
from production_lines l, station_types st
where l.internal_code = 'L001' and st.code = 'sn_bind_pcba'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'ATE1-01', st.id, 'ATE1 半成品测试', 'ATE1 Test', 'Kiểm tra ATE1', 'ATE1-01', 'running'
from production_lines l, station_types st
where l.internal_code = 'L001' and st.code = 'ate_1'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'ULTRA-01', st.id, '超声焊接', 'Ultrasonic Welding', 'Hàn siêu âm', 'ULTRA-01', 'running'
from production_lines l, station_types st
where l.internal_code = 'L001' and st.code = 'ultrasonic'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'BI-LOAD-01', st.id, '老化上机', 'Burn-in Loading', 'Lắp老化', 'BI-LOAD-01', 'running'
from production_lines l, station_types st
where l.internal_code = 'L001' and st.code = 'burnin_load'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'BI-TEST-01', st.id, '老化测试', 'Burn-in Test', 'Kiểm tra老化', 'BI-LOAD-01', 'running'
from production_lines l, station_types st
where l.internal_code = 'L001' and st.code = 'burnin_test'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'HIPOT-01', st.id, '高压测试', 'Hi-pot Test', 'Kiểm tra cao áp', 'HIPOT-01', 'running'
from production_lines l, station_types st
where l.internal_code = 'L001' and st.code = 'hipot'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'ATE2-01', st.id, 'ATE2 成品测试', 'ATE2 Test', 'Kiểm tra ATE2', 'ATE2-01', 'running'
from production_lines l, station_types st
where l.internal_code = 'L001' and st.code = 'ate_2'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'SN-CODE-01', st.id, '绑码 CODE-LINK', 'Code SN Binding', 'Gán mã CODE', null, 'running'
from production_lines l, station_types st
where l.internal_code = 'L001' and st.code = 'sn_bind_code'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'PACK-01', st.id, '包装工位', 'Packing Station', 'Trạm đóng gói', null, 'running'
from production_lines l, station_types st
where l.internal_code = 'L001' and st.code = 'packing'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'PALLET-01', st.id, '栈板标签', 'Pallet Labeling', 'Nhãn pallet', null, 'running'
from production_lines l, station_types st
where l.internal_code = 'L001' and st.code = 'pallet_label'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'APP-DEF-01', st.id, '外观不良上传', 'Appearance Defect Upload', 'Tải lên khuyết tật', null, 'running'
from production_lines l, station_types st
where l.internal_code = 'L001' and st.code = 'appearance_defect'
ON CONFLICT (line_id, code) DO NOTHING;

-- L002 SMT Line 2 (mirrors L001 structure)
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'AI2-01', st.id, 'AI插件机 2号', 'AI Insertion 2', 'Máy cắm AI 2', 'AI2-01', 'idle'
from production_lines l, station_types st
where l.internal_code = 'L002' and st.code = 'ai_insert_2'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'PRINT-02', st.id, '锡膏印刷 2号', 'Solder Paste Printer 2', 'Máy in kem 2', 'PRINT-03', 'idle'
from production_lines l, station_types st
where l.internal_code = 'L002' and st.code = 'smt_mounter_1'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'SPI-02', st.id, 'SPI 锡膏检测 2', 'SPI Inspection 2', 'Kiểm tra SPI 2', 'SPI-02', 'idle'
from production_lines l, station_types st
where l.internal_code = 'L002' and st.code = 'smt_mounter_1'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'NXT-04', st.id, '贴片机 4号', 'SMT Mounter 4', 'Máy đặt 4', 'NXT-04', 'idle'
from production_lines l, station_types st
where l.internal_code = 'L002' and st.code = 'smt_mounter_1'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'NXT-05', st.id, '贴片机 5号', 'SMT Mounter 5', 'Máy đặt 5', 'NXT-05', 'idle'
from production_lines l, station_types st
where l.internal_code = 'L002' and st.code = 'smt_mounter_2'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'NXT-06', st.id, '贴片机 6号', 'SMT Mounter 6', 'Máy đặt 6', 'NXT-06', 'idle'
from production_lines l, station_types st
where l.internal_code = 'L002' and st.code = 'smt_mounter_2'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'REFLOW-02', st.id, '回流焊 2号', 'Reflow Oven 2', 'Lò hồ quang 2', 'REFLOW-02', 'idle'
from production_lines l, station_types st
where l.internal_code = 'L002' and st.code = 'smt_aoi'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'AOI-02', st.id, 'SMT-AOI 检测 2', 'SMT AOI Inspection 2', 'AOI SMT 2', 'AOI-02', 'idle'
from production_lines l, station_types st
where l.internal_code = 'L002' and st.code = 'smt_aoi'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'PCBA-LOAD2', st.id, 'PCBA上料 2', 'PCBA Loading 2', 'Lắp PCBA 2', null, 'idle'
from production_lines l, station_types st
where l.internal_code = 'L002' and st.code = 'pcba_loading'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'PDA-02', st.id, 'PDA 上料扫描 2', 'PDA Scan Loading 2', 'Quét PDA 2', 'PDA-02', 'idle'
from production_lines l, station_types st
where l.internal_code = 'L002' and st.code = 'pda_scan'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'WS-AOI-02', st.id, 'WS-AOI 检测 2', 'Wave Solder AOI 2', 'AOI sóng hàn 2', 'WS-AOI-02', 'idle'
from production_lines l, station_types st
where l.internal_code = 'L002' and st.code = 'wsaoi'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'ICT-02', st.id, 'ICT 测试 2', 'ICT Test 2', 'Kiểm tra ICT 2', 'ICT-02', 'idle'
from production_lines l, station_types st
where l.internal_code = 'L002' and st.code = 'ict'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'FCT-02', st.id, 'FCT 测试 2', 'FCT Test 2', 'Kiểm tra FCT 2', 'FCT-02', 'idle'
from production_lines l, station_types st
where l.internal_code = 'L002' and st.code = 'fct'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'DEPANEL-02', st.id, '分板 2号', 'Board Depaneling 2', 'Tách panel 2', 'DEPANEL-02', 'idle'
from production_lines l, station_types st
where l.internal_code = 'L002' and st.code = 'depanel'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'SN-BIND-02', st.id, '绑码 PCBA_Link 2', 'PCBA SN Binding 2', 'Gán mã PCBA 2', null, 'idle'
from production_lines l, station_types st
where l.internal_code = 'L002' and st.code = 'sn_bind_pcba'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'ATE1-02', st.id, 'ATE1 半成品测试 2', 'ATE1 Test 2', 'Kiểm tra ATE1 2', 'ATE1-02', 'idle'
from production_lines l, station_types st
where l.internal_code = 'L002' and st.code = 'ate_1'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'ULTRA-02', st.id, '超声焊接 2号', 'Ultrasonic Welding 2', 'Hàn siêu âm 2', 'ULTRA-02', 'idle'
from production_lines l, station_types st
where l.internal_code = 'L002' and st.code = 'ultrasonic'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'BI-LOAD-02', st.id, '老化上机 2', 'Burn-in Loading 2', 'Lắp老化 2', 'BI-LOAD-02', 'idle'
from production_lines l, station_types st
where l.internal_code = 'L002' and st.code = 'burnin_load'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'BI-TEST-02', st.id, '老化测试 2', 'Burn-in Test 2', 'Kiểm tra老化 2', 'BI-LOAD-02', 'idle'
from production_lines l, station_types st
where l.internal_code = 'L002' and st.code = 'burnin_test'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'HIPOT-02', st.id, '高压测试 2', 'Hi-pot Test 2', 'Kiểm tra cao áp 2', 'HIPOT-02', 'idle'
from production_lines l, station_types st
where l.internal_code = 'L002' and st.code = 'hipot'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'ATE2-02', st.id, 'ATE2 成品测试 2', 'ATE2 Test 2', 'Kiểm tra ATE2 2', 'ATE2-02', 'idle'
from production_lines l, station_types st
where l.internal_code = 'L002' and st.code = 'ate_2'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'SN-CODE-02', st.id, '绑码 CODE-LINK 2', 'Code SN Binding 2', 'Gán mã CODE 2', null, 'idle'
from production_lines l, station_types st
where l.internal_code = 'L002' and st.code = 'sn_bind_code'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'PACK-02', st.id, '包装工位 2', 'Packing Station 2', 'Trạm đóng gói 2', null, 'idle'
from production_lines l, station_types st
where l.internal_code = 'L002' and st.code = 'packing'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'PALLET-02', st.id, '栈板标签 2', 'Pallet Labeling 2', 'Nhãn pallet 2', null, 'idle'
from production_lines l, station_types st
where l.internal_code = 'L002' and st.code = 'pallet_label'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'APP-DEF-02', st.id, '外观不良上传 2', 'Appearance Defect Upload 2', 'Tải lên khuyết tật 2', null, 'idle'
from production_lines l, station_types st
where l.internal_code = 'L002' and st.code = 'appearance_defect'
ON CONFLICT (line_id, code) DO NOTHING;

-- L003 Assembly Line
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'ASM-AI-01', st.id, '异型插件', 'Odd-form Insertion', 'Cắm linh kiện lạ', 'AI-TH-01', 'idle'
from production_lines l, station_types st
where l.internal_code = 'L003' and st.code = 'ai_insert_1'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'ASM-DJ-01', st.id, '在线点胶', 'Online Dispensing', 'Bơm keo trực tuyến', 'DJ-ASM-01', 'idle'
from production_lines l, station_types st
where l.internal_code = 'L003' and st.code = 'smt_mounter_1'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'ASM-WAVE-01', st.id, '波峰焊', 'Wave Soldering', 'Hàn sóng', 'WAVE-01', 'idle'
from production_lines l, station_types st
where l.internal_code = 'L003' and st.code = 'wsaoi'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'ASM-AOI-01', st.id, '组装AOI', 'Assembly AOI', 'AOI lắp ráp', 'WS-AOI-03', 'idle'
from production_lines l, station_types st
where l.internal_code = 'L003' and st.code = 'wsaoi'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'ASM-ATE1-01', st.id, 'ATE1 半成品测试', 'ATE1 Test', 'Kiểm tra ATE1', 'ATE1-03', 'idle'
from production_lines l, station_types st
where l.internal_code = 'L003' and st.code = 'ate_1'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'ASM-ULT-01', st.id, '超声焊接', 'Ultrasonic Welding', 'Hàn siêu âm', 'ULTRA-03', 'idle'
from production_lines l, station_types st
where l.internal_code = 'L003' and st.code = 'ultrasonic'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'ASM-BI-01', st.id, '老化上机', 'Burn-in Loading', 'Lắp老化', 'BI-ASM-01', 'idle'
from production_lines l, station_types st
where l.internal_code = 'L003' and st.code = 'burnin_load'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'ASM-BI-T01', st.id, '老化测试', 'Burn-in Test', 'Kiểm tra老化', 'BI-ASM-01', 'idle'
from production_lines l, station_types st
where l.internal_code = 'L003' and st.code = 'burnin_test'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'ASM-HP-01', st.id, '高压测试', 'Hi-pot Test', 'Kiểm tra cao áp', 'HIPOT-03', 'idle'
from production_lines l, station_types st
where l.internal_code = 'L003' and st.code = 'hipot'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'ASM-ATE2-01', st.id, 'ATE2 成品测试', 'ATE2 Test', 'Kiểm tra ATE2', 'ATE2-03', 'idle'
from production_lines l, station_types st
where l.internal_code = 'L003' and st.code = 'ate_2'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'ASM-SN-01', st.id, '绑码 CODE-LINK', 'Code SN Binding', 'Gán mã CODE', null, 'idle'
from production_lines l, station_types st
where l.internal_code = 'L003' and st.code = 'sn_bind_code'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'ASM-PACK-01', st.id, '包装', 'Packing', 'Đóng gói', null, 'idle'
from production_lines l, station_types st
where l.internal_code = 'L003' and st.code = 'packing'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'ASM-DEF-01', st.id, '外观不良上传', 'Appearance Defect', 'Tải lên khuyết tật', null, 'idle'
from production_lines l, station_types st
where l.internal_code = 'L003' and st.code = 'appearance_defect'
ON CONFLICT (line_id, code) DO NOTHING;

-- L004 Packing & OQC Line
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'PK-LABEL-01', st.id, '标签打印', 'Label Printing', 'In nhãn', 'LABEL-01', 'idle'
from production_lines l, station_types st
where l.internal_code = 'L004' and st.code = 'packing'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'PK-NAME-01', st.id, '自动贴铭牌 1', 'Auto Nameplate 1', 'Dán tem 1', 'NAMEPLATE-01', 'idle'
from production_lines l, station_types st
where l.internal_code = 'L004' and st.code = 'packing'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'PK-NAME-02', st.id, '自动贴铭牌 2', 'Auto Nameplate 2', 'Dán tem 2', 'NAMEPLATE-02', 'idle'
from production_lines l, station_types st
where l.internal_code = 'L004' and st.code = 'packing'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'PK-SCAN-01', st.id, '包装扫码 1', 'Pack Scan 1', 'Quét đóng gói 1', 'PACK-SCAN-01', 'idle'
from production_lines l, station_types st
where l.internal_code = 'L004' and st.code = 'packing'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'PK-SCAN-02', st.id, '包装扫码 2', 'Pack Scan 2', 'Quét đóng gói 2', 'PACK-SCAN-02', 'idle'
from production_lines l, station_types st
where l.internal_code = 'L004' and st.code = 'packing'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'PK-PALLET-01', st.id, '栈板标签', 'Pallet Labeling', 'Nhãn pallet', null, 'idle'
from production_lines l, station_types st
where l.internal_code = 'L004' and st.code = 'pallet_label'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'OQC-HP-01', st.id, 'OQC 高压测试', 'OQC Hi-pot', 'OQC cao áp', 'OQC-HIPOT-01', 'idle'
from production_lines l, station_types st
where l.internal_code = 'L004' and st.code = 'oqc_hipot'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'OQC-ATE-01', st.id, 'OQC ATE测试 1', 'OQC ATE Test 1', 'OQC kiểm tra ATE 1', 'OQC-ATE-01', 'idle'
from production_lines l, station_types st
where l.internal_code = 'L004' and st.code = 'oqc_ate'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'OQC-ATE-02', st.id, 'OQC ATE测试 2', 'OQC ATE Test 2', 'OQC kiểm tra ATE 2', 'OQC-ATE-02', 'idle'
from production_lines l, station_types st
where l.internal_code = 'L004' and st.code = 'oqc_ate'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'OQC-COS-01', st.id, 'OQC 外观检验', 'OQC Cosmetic Inspection', 'OQC kiểm tra ngoại hình', null, 'idle'
from production_lines l, station_types st
where l.internal_code = 'L004' and st.code = 'oqc_cosmetic'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'OQC-REP-01', st.id, 'OQC 报表记录', 'OQC Report Records', 'Báo cáo OQC', null, 'idle'
from production_lines l, station_types st
where l.internal_code = 'L004' and st.code = 'oqc_report'
ON CONFLICT (line_id, code) DO NOTHING;

-- L099 Rework & Repair Line
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'RW-DEC-01', st.id, '解码工位', 'Decoding Station', 'Trạm giải mã', null, 'idle'
from production_lines l, station_types st
where l.internal_code = 'L099' and st.code = 'decoding'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'RW-BAR-01', st.id, '条码转换', 'Barcode Conversion', 'Chuyển đổi mã vạch', null, 'idle'
from production_lines l, station_types st
where l.internal_code = 'L099' and st.code = 'barcode_convert'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'RW-BAKE-01', st.id, 'PCBA 烘烤', 'MSD Baking', 'Nướng MSĐ', 'RW-OVEN-01', 'idle'
from production_lines l, station_types st
where l.internal_code = 'L099' and st.code = 'msd_baking'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'RW-ST-01', st.id, '返工台', 'Rework Station', 'Trạm sửa lỗi', 'RW-ST-01', 'idle'
from production_lines l, station_types st
where l.internal_code = 'L099' and st.code = 'repair_report'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'RW-HOT-01', st.id, '热风枪拆焊', 'Hot Air Rework', 'Hàn hot air', 'RW-HOTAIR-01', 'idle'
from production_lines l, station_types st
where l.internal_code = 'L099' and st.code = 'repair_report'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'RW-SOLD-01', st.id, '烙铁焊接', 'Soldering Station', 'Trạm hàn thiếc', 'RW-SOLDER-01', 'idle'
from production_lines l, station_types st
where l.internal_code = 'L099' and st.code = 'repair_report'
ON CONFLICT (line_id, code) DO NOTHING;
insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, equipment_code, status)
select l.id, 'RW-REP-01', st.id, '维修报表', 'Repair Report', 'Báo cáo sửa chữa', null, 'idle'
from production_lines l, station_types st
where l.internal_code = 'L099' and st.code = 'repair_report'
ON CONFLICT (line_id, code) DO NOTHING;

-- ============================================================
-- Master Data: Customers, Suppliers, Products, Materials
-- ============================================================
insert into customers (code, name_zh, name_en, name_vi)
values
  ('CUST-HN-01', '河内客户一号', 'Hanoi Customer 01', 'Khách hàng Hà Nội 01'),
  ('CUST-HN-02', '胡志明客户', 'HCMC Customer', 'Khách hàng HCM')
ON CONFLICT (code) DO NOTHING;

insert into suppliers (code, name_zh, name_en, name_vi)
values
  ('SUP-HN-PCB', '河内 PCB 供应商', 'Hanoi PCB Supplier', 'Nhà cung cấp PCB Hà Nội'),
  ('SUP-TPE-RES', '台北电阻供应商', 'Taipei Resistor Supplier', 'Nhà cung cấp điện trở Đài Bắc'),
  ('SUP-SZ-CAP', '深圳电容供应商', 'Shenzhen Capacitor Supplier', 'Nhà cung cấp tụ Đặng')
ON CONFLICT (code) DO NOTHING;

insert into products (code, name_zh, name_en, name_vi, revision)
values
  ('PCBA-AURORA-CTRL', 'Aurora 控制板', 'Aurora Controller PCBA', 'PCBA điều khiển Aurora', 'A1'),
  ('PCBA-POWER-CTRL', '电源控制板', 'Power Controller PCBA', 'PCBA điều khiển nguồn', 'B2')
ON CONFLICT (code) DO NOTHING;

insert into materials (code, name_zh, name_en, name_vi, uom, material_type)
values
  ('PCB-AURORA-CTRL', 'Aurora 控制板裸板', 'Aurora controller bare PCB', 'PCB trần bộ điều khiển Aurora', 'PCS', 'pcb'),
  ('R-0603-10K-1', '贴片电阻 0603 10K', 'Chip resistor 0603 10K', 'Điện trở dán 0603 10K', 'PCS', 'component'),
  ('R-0603-4K7-1', '贴片电阻 0603 4.7K', 'Chip resistor 0603 4.7K', 'Điện trở dán 0603 4.7K', 'PCS', 'component'),
  ('C-0805-100NF', '贴片电容 0805 100nF', 'Chip capacitor 0805 100nF', 'Tụ góp 0805 100nF', 'PCS', 'component')
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- Storage Locations
-- ============================================================
insert into storage_locations (code, area, name_zh, name_en, name_vi)
values
  ('RAW-01-01', 'RAW', '原材料区 01-01', 'Raw Material Area 01-01', 'Khu vật tư 01-01'),
  ('RAW-01-02', 'RAW', '原材料区 01-02', 'Raw Material Area 01-02', 'Khu vật tư 01-02'),
  ('IQC-01', 'IQC', '待检区', 'IQC Pending Area', 'Khu chờ kiểm'),
  ('GOOD-01', 'GOOD', '良品区', 'Good Stock Area', 'Khu thành phẩm'),
  ('HOLD-01', 'HOLD', '冻结区', 'Hold Area', 'Khu cách ly'),
  ('MSD-DRY', 'MSD', 'MSD 防潮柜', 'MSD Dry Cabinet', 'Tủ hút ẩm MSĐ'),
  ('FINISH-01', 'FINISH', '成品仓', 'Finished Goods', 'Kho thành phẩm'),
  ('RETURN-01', 'RETURN', '退货区', 'Return Area', 'Khu trả hàng')
ON CONFLICT (code) DO NOTHING;

-- Additional PO referenced by 002_mvp_extended_seed.sql
insert into customer_pos (po_number, customer_id, product_id, order_qty, due_date)
select 'RJ-VN-PO-240611', c.id, p.id, 24000, date '2026-07-10'
from customers c cross join products p
where c.code = 'CUST-HN-01' and p.code = 'PCBA-AURORA-CTRL'
ON CONFLICT (po_number) DO NOTHING;

-- ============================================================
-- Work Orders
-- ============================================================
insert into work_orders (code, customer_po_id, product_id, line_id, work_order_type, planned_qty, completed_qty, status, released_at)
select '26061010008', po.id, po.product_id, line.id, 1, 9600, 0, 'released', now()
from customer_pos po cross join production_lines line
where po.po_number = 'RJ-VN-PO-26061901' and line.internal_code = 'L001'
ON CONFLICT (code) DO NOTHING;

insert into work_orders (code, customer_po_id, product_id, line_id, work_order_type, planned_qty, completed_qty, status, released_at)
select '26061020008', po.id, po.product_id, line.id, 1, 8000, 0, 'released', now()
from customer_pos po cross join production_lines line
where po.po_number = 'RJ-VN-PO-26061901' and line.internal_code = 'L002'
ON CONFLICT (code) DO NOTHING;
