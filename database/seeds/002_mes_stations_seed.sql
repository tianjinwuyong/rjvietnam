-- MES stations — seeded from MES流程 document (6 sheets)
-- Each station maps to a real SMT production station with zh/en/vi names.
-- Stations are created per SMT Line 1 (L001) by default.
-- Uses station_type_id FK lookup (not station_type string column).

do $$
declare
  v_line_smt int;
  v_sttype_receiving int;
  v_sttype_storage int;
  v_sttype_iqc int;
  v_sttype_mat_prep int;
  v_sttype_ai int;
  v_sttype_glue int;
  v_sttype_placement int;
  v_sttype_reflow int;
  v_sttype_aoi int;
  v_sttype_vi int;
  v_sttype_pcba_load int;
  v_sttype_odd_form int;
  v_sttype_dispense int;
  v_sttype_insert int;
  v_sttype_wave int;
  v_sttype_height int;
  v_sttype_ict int;
  v_sttype_fct int;
  v_sttype_cure int;
  v_sttype_depanel int;
  v_sttype_mos_form int;
  v_sttype_screw int;
  v_sttype_cable int;
  v_sttype_solder int;
  v_sttype_touchup int;
  v_sttype_assy int;
  v_sttype_ate int;
  v_sttype_ultrasonic int;
  v_sttype_bi int;
  v_sttype_psu_dl int;
  v_sttype_stethoscope int;
  v_sttype_hi_pot int;
  v_sttype_load_test int;
  v_sttype_label int;
  v_sttype_pack int;
  v_sttype_oqc int;
  v_sttype_repair int;
  v_sttype_scrap int;
  v_sttype_ai_insert_1 int;
  v_sttype_ai_insert_2 int;
  v_sttype_smt_mounter_1 int;
  v_sttype_smt_mounter_2 int;
  v_sttype_smt_aoi int;
  v_sttype_burnin_test int;
  v_sttype_hipot int;
  v_sttype_pcba_loading int;
  v_sttype_pda_scan int;
  v_sttype_packing int;
begin
  -- Resolve line IDs
  select id into v_line_smt from production_lines where internal_code = 'L001';

  -- Resolve / insert station type IDs
  insert into station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
  values ('RECEIVING', '收料站', 'Receiving Station', 'Trạm nhận hàng', 'production', true, true)
  on conflict (code) do nothing;
  select id into v_sttype_receiving from station_types where code = 'RECEIVING';

  insert into station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
  values ('STORAGE', '仓储站', 'Storage', 'Trạm lưu kho', 'production', false, false)
  on conflict (code) do nothing;
  select id into v_sttype_storage from station_types where code = 'STORAGE';

  insert into station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
  values ('IQC', 'IQC检验站', 'IQC Station', 'Trạm IQC', 'quality', true, true)
  on conflict (code) do nothing;
  select id into v_sttype_iqc from station_types where code = 'IQC';

  insert into station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
  values ('MAT_PREP', '备料站', 'Material Preparation', 'Trạm chuẩn bị vật tư', 'production', true, true)
  on conflict (code) do nothing;
  select id into v_sttype_mat_prep from station_types where code = 'MAT_PREP';

  insert into station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
  values ('AI', '自动插件', 'Auto-Insertion', 'Cắm linh kiện tự động', 'production', true, true)
  on conflict (code) do nothing;
  select id into v_sttype_ai from station_types where code = 'AI';

  insert into station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
  values ('GLUE_PRINT', '红胶印刷', 'Red Glue Printing', 'In keo đỏ', 'production', true, true)
  on conflict (code) do nothing;
  select id into v_sttype_glue from station_types where code = 'GLUE_PRINT';

  insert into station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
  values ('PLACEMENT', '贴片机', 'Placement Machine', 'Máy gắn chip', 'production', true, true)
  on conflict (code) do nothing;
  select id into v_sttype_placement from station_types where code = 'PLACEMENT';

  insert into station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
  values ('REFLOW', '回流焊', 'Reflow Soldering', 'Hàn reflow', 'production', true, true)
  on conflict (code) do nothing;
  select id into v_sttype_reflow from station_types where code = 'REFLOW';

  insert into station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
  values ('AOI', 'AOI检测', 'AOI Inspection', 'AOI', 'production', true, true)
  on conflict (code) do nothing;
  select id into v_sttype_aoi from station_types where code = 'AOI';

  insert into station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
  values ('VI', '目检', 'Visual Inspection', 'Kiểm tra bằng mắt', 'production', false, true)
  on conflict (code) do nothing;
  select id into v_sttype_vi from station_types where code = 'VI';

  insert into station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
  values ('PCBA_LOAD', 'PCBA投入', 'PCBA Loading', 'Nạp PCBA', 'production', false, true)
  on conflict (code) do nothing;
  select id into v_sttype_pcba_load from station_types where code = 'PCBA_LOAD';

  insert into station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
  values ('ODD_FORM', '异形插件', 'Odd-Form Insertion', 'Cắm linh kiện đặc thù', 'production', true, true)
  on conflict (code) do nothing;
  select id into v_sttype_odd_form from station_types where code = 'ODD_FORM';

  insert into station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
  values ('DISPENSE', '点胶', 'Dispensing', 'Phân phối keo', 'production', true, true)
  on conflict (code) do nothing;
  select id into v_sttype_dispense from station_types where code = 'DISPENSE';

  insert into station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
  values ('INSERT', '插件', 'Component Insertion', 'Cắm linh kiện', 'production', true, true)
  on conflict (code) do nothing;
  select id into v_sttype_insert from station_types where code = 'INSERT';

  insert into station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
  values ('WAVE', '波峰焊', 'Wave Soldering', 'Hàn sóng', 'production', true, true)
  on conflict (code) do nothing;
  select id into v_sttype_wave from station_types where code = 'WAVE';

  insert into station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
  values ('HEIGHT', '高度测量', 'Height Measuring', 'Đo chiều cao', 'production', true, true)
  on conflict (code) do nothing;
  select id into v_sttype_height from station_types where code = 'HEIGHT';

  insert into station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
  values ('ICT', 'ICT测试', 'ICT Test', 'Kiểm tra ICT', 'production', true, true)
  on conflict (code) do nothing;
  select id into v_sttype_ict from station_types where code = 'ICT';

  insert into station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
  values ('FCT', 'FCT测试', 'FCT Test', 'Kiểm tra FCT', 'production', true, true)
  on conflict (code) do nothing;
  select id into v_sttype_fct from station_types where code = 'FCT';

  insert into station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
  values ('CURE', '胶水固化', 'Glue Curing', 'Tủ đóng rắn keo', 'production', true, true)
  on conflict (code) do nothing;
  select id into v_sttype_cure from station_types where code = 'CURE';

  insert into station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
  values ('DEPANEL', '分板', 'Depaneling', 'Phân mạch', 'production', true, true)
  on conflict (code) do nothing;
  select id into v_sttype_depanel from station_types where code = 'DEPANEL';

  insert into station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
  values ('MOS_FORM', 'MOS成型', 'MOS Forming', 'Tạo hình MOS', 'production', true, true)
  on conflict (code) do nothing;
  select id into v_sttype_mos_form from station_types where code = 'MOS_FORM';

  insert into station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
  values ('SCREW', '螺丝', 'Screw Fastening', 'Vít tản nhiệt', 'production', true, true)
  on conflict (code) do nothing;
  select id into v_sttype_screw from station_types where code = 'SCREW';

  insert into station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
  values ('CABLE', '线缆', 'Cable Assembly', 'Lắp cáp', 'production', true, true)
  on conflict (code) do nothing;
  select id into v_sttype_cable from station_types where code = 'CABLE';

  insert into station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
  values ('SOLDER', '焊接', 'Soldering', 'Hàn', 'production', true, true)
  on conflict (code) do nothing;
  select id into v_sttype_solder from station_types where code = 'SOLDER';

  insert into station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
  values ('TOUCHUP', '补焊', 'Touch Up', 'Hàn bổ sung', 'production', true, true)
  on conflict (code) do nothing;
  select id into v_sttype_touchup from station_types where code = 'TOUCHUP';

  insert into station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
  values ('ASSY', '组装', 'Assembly', 'Lắp ráp', 'production', true, true)
  on conflict (code) do nothing;
  select id into v_sttype_assy from station_types where code = 'ASSY';

  insert into station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
  values ('ATE', 'ATE测试', 'ATE Test', 'Kiểm tra ATE', 'production', true, true)
  on conflict (code) do nothing;
  select id into v_sttype_ate from station_types where code = 'ATE';

  insert into station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
  values ('ULTRASONIC', '超声波焊接', 'Ultrasonic Welding', 'Hàn siêu âm', 'production', true, true)
  on conflict (code) do nothing;
  select id into v_sttype_ultrasonic from station_types where code = 'ULTRASONIC';

  insert into station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
  values ('BI', '老化', 'Burn-in', 'Già hóa', 'production', true, true)
  on conflict (code) do nothing;
  select id into v_sttype_bi from station_types where code = 'BI';

  insert into station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
  values ('PSU_DL', '电源下载', 'PSU Downloading', 'Tải xuống PSU', 'production', true, true)
  on conflict (code) do nothing;
  select id into v_sttype_psu_dl from station_types where code = 'PSU_DL';

  insert into station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
  values ('STETHOSCOPE', '听音器检测', 'Stethoscope Test', 'Kiểm tra ống nghe', 'production', true, true)
  on conflict (code) do nothing;
  select id into v_sttype_stethoscope from station_types where code = 'STETHOSCOPE';

  insert into station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
  values ('HI_POT', '耐压测试', 'Hi-pot Test', 'Kiểm tra Hi-pot', 'production', true, true)
  on conflict (code) do nothing;
  select id into v_sttype_hi_pot from station_types where code = 'HI_POT';

  insert into station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
  values ('LOAD_TEST', '负载测试', 'Loading Test', 'Kiểm tra tải', 'production', true, true)
  on conflict (code) do nothing;
  select id into v_sttype_load_test from station_types where code = 'LOAD_TEST';

  insert into station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
  values ('LABEL', '贴标', 'Labeling', 'Dán nhãn', 'production', false, true)
  on conflict (code) do nothing;
  select id into v_sttype_label from station_types where code = 'LABEL';

  insert into station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
  values ('PACK', '包装', 'Packing', 'Đóng gói', 'production', false, true)
  on conflict (code) do nothing;
  select id into v_sttype_pack from station_types where code = 'PACK';

  insert into station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
  values ('OQC', 'OQC检验', 'OQC Inspection', 'Kiểm tra OQC', 'oqc', true, true)
  on conflict (code) do nothing;
  select id into v_sttype_oqc from station_types where code = 'OQC';

  insert into station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
  values ('REPAIR', '维修站', 'Repair Station', 'Trạm sửa chữa', 'repair', false, true)
  on conflict (code) do nothing;
  select id into v_sttype_repair from station_types where code = 'REPAIR';

  insert into station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
  values ('SCRAP', '报废站', 'Scrap Station', 'Trạm loại bỏ', 'production', false, true)
  on conflict (code) do nothing;
  select id into v_sttype_scrap from station_types where code = 'SCRAP';

  insert into station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
  values ('ai_insert_1', 'AI插件机 1号', 'AI Insertion Machine 1', 'Máy cắm AI 1', 'production', true, true)
  on conflict (code) do nothing;
  select id into v_sttype_ai_insert_1 from station_types where code = 'ai_insert_1';

  insert into station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
  values ('ai_insert_2', 'AI插件机 2号', 'AI Insertion Machine 2', 'Máy cắm AI 2', 'production', true, true)
  on conflict (code) do nothing;
  select id into v_sttype_ai_insert_2 from station_types where code = 'ai_insert_2';

  insert into station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
  values ('smt_mounter_1', '贴片机 1号', 'SMT Mounter 1', 'Máy gắn SMT 1', 'production', true, true)
  on conflict (code) do nothing;
  select id into v_sttype_smt_mounter_1 from station_types where code = 'smt_mounter_1';

  insert into station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
  values ('smt_mounter_2', '贴片机 2号', 'SMT Mounter 2', 'Máy gắn SMT 2', 'production', true, true)
  on conflict (code) do nothing;
  select id into v_sttype_smt_mounter_2 from station_types where code = 'smt_mounter_2';

  insert into station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
  values ('smt_aoi', 'SMT-AOI', 'SMT AOI Inspection', 'AOI SMT', 'production', true, true)
  on conflict (code) do nothing;
  select id into v_sttype_smt_aoi from station_types where code = 'smt_aoi';

  insert into station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
  values ('burnin_test', '老化测试', 'Burn-in Test', 'Kiểm tra già hóa', 'production', true, true)
  on conflict (code) do nothing;
  select id into v_sttype_burnin_test from station_types where code = 'burnin_test';

  insert into station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
  values ('hipot', '高压测试', 'Hi-pot Test', 'Kiểm tra Hi-pot', 'production', true, true)
  on conflict (code) do nothing;
  select id into v_sttype_hipot from station_types where code = 'hipot';

  insert into station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
  values ('pcba_loading', 'PCBA上料', 'PCBA Loading', 'Nạp PCBA', 'production', false, true)
  on conflict (code) do nothing;
  select id into v_sttype_pcba_loading from station_types where code = 'pcba_loading';

  insert into station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
  values ('pda_scan', 'PDA上料扫描', 'PDA Scan Loading', 'Quét PDA nạp liệu', 'production', true, true)
  on conflict (code) do nothing;
  select id into v_sttype_pda_scan from station_types where code = 'pda_scan';

  insert into station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
  values ('ultrasonic', '超声焊接', 'Ultrasonic Welding', 'Hàn siêu âm', 'production', true, true)
  on conflict (code) do nothing;
  select id into v_sttype_ultrasonic from station_types where code = 'ultrasonic';

  insert into station_types (code, name_zh, name_en, name_vi, category, has_hardware, has_software)
  values ('packing', '包装工位', 'Packing Station', 'Trạm đóng gói', 'production', false, true)
  on conflict (code) do nothing;
  select id into v_sttype_packing from station_types where code = 'packing';

  -- ======== SMT Section ========
  insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, status)
  values
    (v_line_smt, 'RECEIVING-01', v_sttype_receiving, '收料站', 'Receiving Station', 'Trạm nhận hàng', 'idle'),
    (v_line_smt, 'STORAGE-01',   v_sttype_storage,   '仓储站',   'Storage',           'Trạm lưu kho',    'idle'),
    (v_line_smt, 'IQC-01',       v_sttype_iqc,       'IQC检验站', 'IQC Station',     'Trạm IQC',        'idle'),
    (v_line_smt, 'MAT-PREP-01',  v_sttype_mat_prep,  '备料站', 'Material Preparation', 'Trạm chuẩn bị vật tư', 'idle'),
    (v_line_smt, 'AI-VERT-01',   v_sttype_ai,        '自动插件(立式)', 'Auto-Insertion Vertical', 'Cắm linh kiện tự động (đứng)', 'idle'),
    (v_line_smt, 'AI1-01',       v_sttype_ai_insert_1, 'AI插件机 1号', 'AI Insertion Machine 1', 'Máy cắm AI 1', 'idle'),
    (v_line_smt, 'NXT-01',       v_sttype_smt_mounter_1, '贴片机 1号', 'SMT Mounter 1', 'Máy gắn SMT 1', 'idle'),
    (v_line_smt, 'NXT-02',       v_sttype_smt_mounter_2, '贴片机 2号', 'SMT Mounter 2', 'Máy gắn SMT 2', 'idle'),
    (v_line_smt, 'NXT-03',       v_sttype_smt_mounter_2, '贴片机 3号', 'SMT Mounter 3', 'Máy gắn SMT 3', 'idle'),
    (v_line_smt, 'PRINT-01',     v_sttype_smt_mounter_1, '锡膏印刷 1号', 'Solder Paste Printer 1', 'Máy in kem hàn 1', 'idle'),
    (v_line_smt, 'SPI-01',       v_sttype_smt_mounter_1, 'SPI 锡膏检测', 'SPI Inspection', 'Kiểm tra kem hàn SPI', 'idle'),
    (v_line_smt, 'AOI-01',       v_sttype_smt_aoi,   'SMT-AOI 检测', 'SMT AOI Inspection', 'AOI SMT', 'idle'),
    (v_line_smt, 'GLUE-PRINT-01',v_sttype_glue,      '红胶印刷', 'Red Glue Printing', 'In keo đỏ',        'idle'),
    (v_line_smt, 'PLACEMENT-01', v_sttype_placement, '贴片机', 'Placement Machine', 'Máy gắn chip',    'idle'),
    (v_line_smt, 'REFLOW-01',    v_sttype_reflow,    '回流焊', 'Reflow Soldering', 'Hàn reflow',       'idle'),
    (v_line_smt, 'SMT-AOI-01',   v_sttype_aoi,       'SMT-AOI检测', 'SMT AOI',   'AOI SMT',           'idle'),
    (v_line_smt, 'SMT-VI-01',    v_sttype_vi,        'SMT目检', 'SMT Visual Inspection', 'Kiểm tra bằng mắt SMT', 'idle')
  on conflict (line_id, code) do nothing;

  -- ======== Wave Soldering Section ========
  insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, status)
  values
    (v_line_smt, 'PCBA-LOAD-01',  v_sttype_pcba_load, 'PCBA投入', 'PCBA Loading',          'Nạp PCBA',                          'idle'),
    (v_line_smt, 'PCBA-LOAD',     v_sttype_pcba_loading, 'PCBA上料', 'PCBA Loading',       'Nạp PCBA',                          'idle'),
    (v_line_smt, 'PDA-01',        v_sttype_pda_scan,   'PDA 上料扫描', 'PDA Scan Loading',  'Quét PDA nạp liệu',                'idle'),
    (v_line_smt, 'ODD-FORM-01',    v_sttype_odd_form,  '异形插件', 'Odd-Form Insertion',   'Cắm linh kiện đặc thù',           'idle'),
    (v_line_smt, 'DISPENSE-01',   v_sttype_dispense,  '自动点胶1', 'Auto Dispensing 1',   'Phân phối keo tự động 1',         'idle'),
    (v_line_smt, 'INSERT-C1A-01', v_sttype_insert,    '插件C1A/T1', 'Insertion C1A/T1',   'Cắm C1A/T1',                        'idle'),
    (v_line_smt, 'INSERT-HS1-01', v_sttype_insert,    '插件HS1', 'Insertion HS1',         'Cắm HS1',                           'idle'),
    (v_line_smt, 'INSERT-HS2-01', v_sttype_insert,    '插件HS2', 'Insertion HS2',         'Cắm HS2',                           'idle'),
    (v_line_smt, 'WAVE-VI-01',    v_sttype_vi,        '波峰焊目检', 'Wave VI',           'Kiểm tra bằng mắt hàn sóng',       'idle'),
    (v_line_smt, 'WAVE-01',       v_sttype_wave,      '波峰焊', 'Wave Soldering',        'Hàn sóng',                          'idle'),
    (v_line_smt, 'HEIGHT-01',     v_sttype_height,    'PCBA高度测量', 'PCBA Height Measuring', 'Đo chiều cao PCBA',              'idle'),
    (v_line_smt, 'WS-AOI-01',    v_sttype_aoi,       'WS-AOI检测', 'Wave Solder AOI',    'AOI hàn sóng',                      'idle'),
    (v_line_smt, 'ICT-01',        v_sttype_ict,       'ICT自动测试', 'ICT Automatic Test', 'Kiểm tra ICT tự động',              'idle'),
    (v_line_smt, 'FCT-01',        v_sttype_fct,       'FCT自动测试', 'FCT Automatic Test', 'Kiểm tra FCT tự động',              'idle'),
    (v_line_smt, 'DISPENSE-02',   v_sttype_dispense,  '自动点胶2', 'Auto Dispensing 2',   'Phân phối keo tự động 2',         'idle'),
    (v_line_smt, 'CURE-01',       v_sttype_cure,      '胶水固化', 'Glue Curing Cabinet',  'Tủ đóng rắn keo',                  'idle'),
    (v_line_smt, 'DEPANEL-01',   v_sttype_depanel,   '自动分板', 'Auto Depaneling',       'Phân mạch tự động',                'idle')
  on conflict (line_id, code) do nothing;

  -- ======== Assembly Section ========
  insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, status)
  values
    (v_line_smt, 'MOS-FORM-01',   v_sttype_mos_form,  'MOS成型', 'MOS Forming',              'Tạo hình MOS',                     'idle'),
    (v_line_smt, 'HS-SCREW-01',   v_sttype_screw,     '自动锁散热片', 'Auto Heat Sink Screw', 'Vít tản nhiệt tự động',           'idle'),
    (v_line_smt, 'AC-CABLE-01',   v_sttype_cable,     'AC线组装', 'AC Cable Assembly',         'Lắp cáp AC',                       'idle'),
    (v_line_smt, 'AC-SOLDER-01',  v_sttype_solder,    'AC线焊接', 'AC Cable Soldering',         'Hàn cáp AC',                       'idle'),
    (v_line_smt, 'DC-CABLE-01',   v_sttype_cable,     'DC线组装', 'DC Cable Assembly',         'Lắp cáp DC',                       'idle'),
    (v_line_smt, 'DC-SOLDER-01',   v_sttype_solder,    'DC线焊接', 'DC Cable Soldering',         'Hàn cáp DC',                       'idle'),
    (v_line_smt, 'VI-CCD-01',      v_sttype_vi,        '目检/CCD', 'VI/CCD',                   'Kiểm tra bằng mắt/CCD',            'idle'),
    (v_line_smt, 'TOUCHUP-01',    v_sttype_touchup,   '补焊站', 'Touch Up',                    'Trạm hàn bổ sung',                 'idle'),
    (v_line_smt, 'ASSY-GLUE-01',  v_sttype_assy,      '组装点胶', 'Assembly Dispensing',        'Lắp ráp phân phối keo',             'idle'),
    (v_line_smt, 'TOP-ENCL-01',   v_sttype_assy,      '上盖组装', 'Top Enclosure Assy',       'Lắp vỏ trên',                      'idle')
  on conflict (line_id, code) do nothing;

  -- ======== Test & Pack Section ========
  insert into stations (line_id, code, station_type_id, name_zh, name_en, name_vi, status)
  values
    (v_line_smt, 'ATE1-01',       v_sttype_ate,         'ATE1测试', 'ATE1 Test',              'Kiểm tra ATE1',                    'idle'),
    (v_line_smt, 'ULTRASONIC-01', v_sttype_ultrasonic,  '超声波焊接', 'Ultrasonic Welding',    'Hàn siêu âm',                      'idle'),
    (v_line_smt, 'FINAL-VI-01',   v_sttype_vi,          '最终目检', 'Final VI',               'Kiểm tra bằng mắt cuối',           'idle'),
    (v_line_smt, 'BI-LOAD-01',    v_sttype_bi,          '老化前加载', 'Pre Burn-in Loading',   'Nạp trước già hóa',               'idle'),
    (v_line_smt, 'BI-TEST-01',    v_sttype_burnin_test, '老化测试', 'Burn-in Test',          'Kiểm tra già hóa',                  'idle'),
    (v_line_smt, 'BURN-IN-01',    v_sttype_bi,           '老化房', 'Burn-in Chamber',          'Phòng già hóa',                    'idle'),
    (v_line_smt, 'HIPOT-01',      v_sttype_hipot,       '高压测试', 'Hi-pot Test',            'Kiểm tra Hi-pot',                  'idle'),
    (v_line_smt, 'ULTRA-01',      v_sttype_ultrasonic,  '超声焊接', 'Ultrasonic Welding',     'Hàn siêu âm',                      'idle'),
    (v_line_smt, 'PSU-DL-01',    v_sttype_psu_dl,       '电源下载', 'PSU Downloading',          'Tải xuống PSU',                    'idle'),
    (v_line_smt, 'STETHOSCOPE-01',v_sttype_stethoscope, '听音器检测', 'Stethoscope Test',      'Kiểm tra ống nghe',                'idle'),
    (v_line_smt, 'HI-POT-01',    v_sttype_hi_pot,       '耐压测试', 'Hi-pot Test',            'Kiểm tra Hi-pot',                  'idle'),
    (v_line_smt, 'ATE2-01',       v_sttype_ate,         'ATE2测试', 'ATE2 Test',              'Kiểm tra ATE2',                    'idle'),
    (v_line_smt, 'LOAD-TEST-01', v_sttype_load_test,   '负载测试', 'Loading Test',            'Kiểm tra tải',                     'idle'),
    (v_line_smt, 'ENCL-LABEL-01',v_sttype_label,       '机壳贴标', 'Enclosure Labeling',      'Dán nhãn vỏ',                      'idle'),
    (v_line_smt, 'AC-LABEL-01',  v_sttype_label,       'AC线贴标', 'AC Cable Labeling',        'Dán nhãn cáp AC',                  'idle'),
    (v_line_smt, 'PACK-01',      v_sttype_packing,     '包装工位', 'Packing Station',        'Trạm đóng gói',                    'idle'),
    (v_line_smt, 'PACK-SCAN-01', v_sttype_pack,        '包装扫描', 'Packing Scanning',         'Quét bao bì',                      'idle'),
    (v_line_smt, 'PE-BAG-01',    v_sttype_pack,         'PE袋装', 'PE Bagging',               'Đóng túi PE',                      'idle'),
    (v_line_smt, 'BOX-SEAL-01',  v_sttype_pack,         '自动封箱', 'Auto Box Sealing',       'Dán thùng tự động',               'idle'),
    (v_line_smt, 'AUTO-PACK-01', v_sttype_pack,         '自动打包', 'Auto Packing',            'Đóng gói tự động',                  'idle'),
    (v_line_smt, 'OQC-01',        v_sttype_oqc,          'OQC检验', 'OQC Inspection',          'Kiểm tra OQC',                     'idle'),
    (v_line_smt, 'TEMP-STORAGE-01', v_sttype_storage,   '成品暂存', 'FG Temporary Storage',    'Lưu tạm thành phẩm',              'idle'),
    (v_line_smt, 'REPAIR-01',     v_sttype_repair,       '维修站', 'Repair Station',           'Trạm sửa chữa',                   'idle'),
    (v_line_smt, 'SCRAP-01',      v_sttype_scrap,        '报废站', 'Scrap Station',            'Trạm loại bỏ',                     'idle')
  on conflict (line_id, code) do nothing;

end $$;
