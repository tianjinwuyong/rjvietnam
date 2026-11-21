-- =====================================================================
-- Migration 042: Equipment Asset Registration & Auto PM Plan Generation
-- 1. Seed equipment_categories & models for all machine types
-- 2. Create equipment_assets for all existing machines (machines table)
-- 3. Auto-generate maintenance_plans from 041 maint_task_library
-- 4. Auto-generate inspection_assignments for today+tomorrow
-- =====================================================================

begin;

-- ============================================================
-- 1. Equipment Categories (seed from factory machine_types)
-- ============================================================

insert into equipment_categories (code, name_zh, name_en, name_vi) values
('SMT-MOUNT', 'SMT贴片机', 'SMT Mounter', 'Máy gắp SMT'),
('REFLOW', '回流焊炉', 'Reflow Oven', 'Lò hàn Reflow'),
('PRINTER', '锡膏印刷机', 'Solder Paste Printer', 'Máy in kem hàn'),
('SPI', 'SPI锡膏检测机', 'SPI', 'Máy kiểm tra kem hàn SPI'),
('AOI', 'AOI光学检测机', 'AOI', 'Máy AOI'),
('PCB-LASER', 'PCB激光刻蚀机', 'PCB Laser Marker', 'Máy khắc laser PCB'),
('AI-INSERT', 'AI插件机', 'AI Insertion Machine', 'Máy cắm AI'),
('WAVE-SOLDER', '波峰焊', 'Wave Soldering', 'Máy hàn sóng'),
('ICT', 'ICT在线测试仪', 'ICT', 'Máy ICT'),
('FCT', 'FCT功能测试仪', 'FCT', 'Máy FCT'),
('DEPANEL', '分板机', 'Depanel Machine', 'Máy cắt panel'),
('ULTRASONIC', '超声波清洗机', 'Ultrasonic Cleaner', 'Máy rửa siêu âm'),
('BURNIN', '老化测试机', 'Burn-in Tester', 'Máy test burn-in'),
('HIPOT', '耐压测试仪', 'Hi-Pot Tester', 'Máy test cao áp'),
('DISPENSER', '点胶机', 'Dispenser', 'Máy bơm keo'),
('ATE', 'ATE自动测试设备', 'ATE', 'Thiết bị test tự động ATE'),
('REWORK', '返修工作站', 'Rework Station', 'Trạm hàn lại'),
('HOT-AIR', '热风枪', 'Hot Air Gun', 'Máy khò nhiệt'),
('SOLDER-IRON', '烙铁', 'Soldering Iron', 'Mỏ hàn'),
('LABEL-PRINT', '标签打印机', 'Label Printer', 'Máy in nhãn'),
('NAMEPLATE', '铭牌机', 'Nameplate Printer', 'Máy in biển mác'),
('PACK-SCAN', '包装扫描设备', 'Packaging Scanner', 'Máy quét đóng gói'),
('WS-AOI', 'WS-AOI检测机', 'Wave Solder AOI', 'Máy AOI sau hàn sóng'),
('PDA', 'PDA手持终端', 'PDA Handheld', 'PDA cầm tay')
on conflict (code) do nothing;

-- ============================================================
-- 2. Equipment Models (seed common brands per category)
-- ============================================================

insert into equipment_models (code, category_id, vendor_name, model_name) values
-- SMT Mounter
('MDL-NPM-D3A', (select id from equipment_categories where code='SMT-MOUNT'), '松下/Panasonic', 'NPM-D3A'),
('MDL-YSM', (select id from equipment_categories where code='SMT-MOUNT'), '雅马哈/YAMAHA', 'YSM-R'),
('MDL-SM481', (select id from equipment_categories where code='SMT-MOUNT'), '韩华/Hanwha', 'SM481'),
-- Reflow
('MDL-JTR-1000D', (select id from equipment_categories where code='REFLOW'), '劲拓/JT', 'JTR-1000D'),
('MDL-HELLER', (select id from equipment_categories where code='REFLOW'), 'Heller', '1809EXL'),
('MDL-SENZO', (select id from equipment_categories where code='REFLOW'), '科莱电/Nutech', 'SENZO-D'),
-- Printer
('MDL-GSK', (select id from equipment_categories where code='PRINTER'), 'GKG', 'GSK'),
('MDL-DEK', (select id from equipment_categories where code='PRINTER'), 'DEK', 'Horizon'),
-- SPI
('MDL-AIS631', (select id from equipment_categories where code='SPI'), '镭晨', 'AIS631MB-HW'),
-- AOI
('MDL-AIS430', (select id from equipment_categories where code='AOI'), '镭晨', 'AIS430-D'),
('MDL-SAKI', (select id from equipment_categories where code='AOI'), 'SAKI', '3D-SPI'),
-- PCB Laser
('MDL-HC-FYC5W', (select id from equipment_categories where code='PCB-LASER'), '弘创', 'HC-FYC5W'),
-- AI Insertion
('MDL-HS-K6S', (select id from equipment_categories where code='AI-INSERT'), '中禾旭', 'HS-K6S'),
('MDL-JUKI-JM100', (select id from equipment_categories where code='AI-INSERT'), 'JUKI', 'JM-100'),
-- Wave Solder
('MDL-ZKS-3B', (select id from equipment_categories where code='WAVE-SOLDER'), '中禾旭', 'ZKS-3B'),
-- ICT
('MDL-FYK-CS801', (select id from equipment_categories where code='ICT'), '富源科', 'FYK-CS-801'),
('MDL-SRC8001', (select id from equipment_categories where code='ICT'), '泰视特测', 'SRC8001'),
-- FCT
('MDL-FYK-CS432', (select id from equipment_categories where code='FCT'), '富源科', 'FYK-CS-432'),
-- Depanel
('MDL-EXE880', (select id from equipment_categories where code='DEPANEL'), '富源科', 'EXE880AT'),
-- Ultrasonic
('MDL-FYK-CS701', (select id from equipment_categories where code='ULTRASONIC'), '富源科', 'FYK-CS-701'),
-- Burnin
('MDL-CHZN-1200S', (select id from equipment_categories where code='BURNIN'), '创华', 'CHZN-1200S'),
-- Hi-Pot
('MDL-ATS-HIPOT', (select id from equipment_categories where code='HIPOT'), '安拓森', 'ATS-HIPOT'),
-- Dispenser
('MDL-FYK-DJ101', (select id from equipment_categories where code='DISPENSER'), '富源科', 'FYK-DJ-101'),
-- ATE
('MDL-ATS-ATE', (select id from equipment_categories where code='ATE'), '安拓森', 'ATS-ATE'),
-- Label Printer
('MDL-ZEBRA-ZT', (select id from equipment_categories where code='LABEL-PRINT'), 'Zebra', 'ZT411'),
-- Nameplate
('MDL-ZND-NM', (select id from equipment_categories where code='NAMEPLATE'), '中能达', 'ZND-NM')
on conflict (code) do nothing;

-- ============================================================
-- 3. Create equipment_assets for ALL existing machines
-- ============================================================

insert into equipment_assets (
  asset_code, category_id, model_id, machine_id,
  line_id, station_id, serial_no, install_date, status
)
select
  'AST-' || m.code,                                              -- asset_code
  ec.id,                                                          -- category_id
  em.id,                                                          -- model_id
  m.id,                                                           -- machine_id
  m.line_id,                                                      -- line_id
  m.station_id,                                                   -- station_id
  m.serial_no,                                                    -- serial_no
  current_date - ((random() * 730)::int * interval '1 day') as install_date,     -- install_date (random past 2 yrs)
  'active'
from machines m
left join equipment_categories ec on ec.name_en = (
  case m.machine_type
    when 'mounter'      then 'SMT Mounter'
    when 'reflow'       then 'Reflow Oven'
    when 'printer'      then 'Solder Paste Printer'
    when 'SPI'          then 'SPI'
    when 'AOI'          then 'AOI'
    when 'pcb_laser'    then 'PCB Laser Marker'
    when 'ai_insert'    then 'AI Insertion Machine'
    when 'wave_solder'  then 'Wave Soldering'
    when 'ICT'          then 'ICT'
    when 'FCT'          then 'FCT'
    when 'depanel'      then 'Depanel Machine'
    when 'ultrasonic'   then 'Ultrasonic Cleaner'
    when 'burnin'       then 'Burn-in Tester'
    when 'hipot'        then 'Hi-Pot Tester'
    when 'dispenser'    then 'Dispenser'
    when 'ATE'          then 'ATE'
    when 'rework_station' then 'Rework Station'
    when 'hot_air_gun'  then 'Hot Air Gun'
    when 'soldering_iron' then 'Soldering Iron'
    when 'label_printer' then 'Label Printer'
    when 'nameplate'    then 'Nameplate Printer'
    when 'pack_scan'    then 'Packaging Scanner'
    when 'WS-AOI'       then 'Wave Solder AOI'
    when 'PDA'          then 'PDA Handheld'
    else m.machine_type
  end
)
left join equipment_models em on em.vendor_name = m.brand and em.category_id = ec.id
where not exists (select 1 from equipment_assets ea where ea.machine_id = m.id)
on conflict (asset_code) do nothing;

-- ============================================================
-- 4. Auto-generate maintenance_plans from task library
-- Frequency mapping: task_library.frequency → plans.frequency_type/value
-- ============================================================

insert into maintenance_plans (
  plan_no, asset_id, plan_type, frequency_type, frequency_value,
  next_due_date, status
)
select
  'PLN-' || ea.asset_code || '-' || mt.frequency || '-' ||
    to_char(now(), 'YYYYMMDD') || '-' ||
    row_number() over (partition by ea.id order by mt.id),
  ea.id,
  'preventive',
  case mt.frequency
    when 'shift'      then 'days'
    when 'daily'      then 'days'
    when 'weekly'      then 'days'
    when 'monthly'     then 'days'
    when 'quarterly'   then 'days'
    when '半年度'      then 'days'
    when '年度'        then 'days'
    else 'days'
  end,
  case mt.frequency
    when 'shift'     then 1
    when 'daily'     then 1
    when 'weekly'    then 7
    when 'monthly'   then 30
    when 'quarterly' then 90
    when '半年度'    then 180
    when '年度'      then 365
    else 30
  end,
  case mt.frequency
    when 'shift'     then current_date
    when 'daily'     then current_date
    when 'weekly'    then current_date + 7
    when 'monthly'   then current_date + 30
    when 'quarterly' then current_date + 90
    when '半年度'   then current_date + 180
    when '年度'     then current_date + 365
    else current_date + 30
  end,
  'active'
from maint_task_library mt
cross join equipment_assets ea
join machines m on m.id = ea.machine_id
where m.machine_type = mt.machine_type
  and mt.frequency in ('daily', 'weekly', 'monthly', 'quarterly')
  and not exists (
    select 1 from maintenance_plans mp
    where mp.asset_id = ea.id
      and mp.plan_type = 'preventive'
  )
on conflict do nothing;

-- ============================================================
-- 5. Auto-generate inspection_assignments for today + tomorrow
-- (shift: day/night, frequency: daily templates only)
-- ============================================================

insert into inspection_assignments (
  assignment_no, machine_id, template_id, shift_date, shift_type,
  assigned_to, status
)
select
  'IA-' || m.code || '-' || to_char(current_date, 'YYYYMMDD') || '-' || s.shift,
  m.id,
  t.id,
  current_date,
  s.shift,
  (select id from users where role_id = (select id from roles where code='smt_operator') limit 1),
  'pending'
from machines m
cross join (values ('day'), ('night')) s(shift)
join inspection_templates t on t.machine_type = m.machine_type and t.frequency_type = 'daily'
where m.machine_type in ('mounter','reflow','printer','SPI','AOI')
  and not exists (
    select 1 from inspection_assignments ia
    where ia.machine_id = m.id
      and ia.shift_date = current_date
      and ia.shift_type = s.shift
  )
union all
select
  'IA-' || m.code || '-' || to_char(current_date + 1, 'YYYYMMDD') || '-' || s.shift,
  m.id,
  t.id,
  current_date + 1,
  s.shift,
  (select id from users where role_id = (select id from roles where code='smt_operator') limit 1),
  'pending'
from machines m
cross join (values ('day'), ('night')) s(shift)
join inspection_templates t on t.machine_type = m.machine_type and t.frequency_type = 'daily'
where m.machine_type in ('mounter','reflow','printer','SPI','AOI')
  and not exists (
    select 1 from inspection_assignments ia
    where ia.machine_id = m.id
      and ia.shift_date = current_date + 1
      and ia.shift_type = s.shift
  )
on conflict (assignment_no) do nothing;

-- ============================================================
-- 6. Insert facility_assets (基础设施 assets)
-- ============================================================

insert into facility_assets (asset_code, category_id, name_zh, name_en, name_vi, status)
select
  fc.code || '-01',
  fc.id,
  fc.name_zh || ' 1号',
  fc.name_en || ' No.1',
  fc.name_vi || ' số 1',
  'active'
from facility_categories fc
where not exists (
  select 1 from facility_assets fa where fa.asset_code = fc.code || '-01'
)
on conflict (asset_code) do nothing;

commit;
