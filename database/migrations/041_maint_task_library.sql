-- =====================================================================
-- Equipment Maintenance Task Library Seed Data
-- Maintenance task definitions per machine_type for PM planning
-- Run AFTER 001 seed + 040_machine_inspection.sql
-- =====================================================================

begin;

-- =====================================================================
-- MAINTENANCE TASK TEMPLATES (for each machine_type)
-- Each task has frequency, estimated minutes, skill level, tools needed
-- =====================================================================

create table if not exists maint_task_library (
  id bigserial primary key,
  task_code varchar(80) not null unique,
  machine_type varchar(40) not null,
  task_name_zh varchar(200) not null,
  task_name_en varchar(200) not null,
  frequency varchar(20) not null, -- shift/daily/weekly/monthly/quarterly/半年度/年度
  estimated_minutes integer not null default 30,
  skill_level varchar(20) not null default 'operator', -- operator/technician/engineer
  safety_required boolean not null default false,
  is_critical_path boolean not null default false,
  description_zh text,
  description_en text,
  tools_required varchar(300),
  parts_may_need varchar(300),
  created_at timestamptz not null default now()
);

-- ============================================================
-- WEAR PARTS REFERENCE (per machine_type)
-- ============================================================

create table if not exists wear_parts_reference (
  id bigserial primary key,
  machine_type varchar(40) not null,
  part_name_zh varchar(200) not null,
  part_name_en varchar(200) not null,
  part_code varchar(80),
  typical_lifetime_zh varchar(200),
  typical_lifetime_en varchar(200),
  replacement_frequency varchar(40), -- e.g. "every 3 months" or "5000 hours"
  is_safety_critical boolean not null default false,
  created_at timestamptz not null default now()
);

-- ============================================================
-- SEED: Maintenance task library for each machine type
-- ============================================================

-- =====================================================================
-- 1. SMT 贴片机 / MOUNTER (松下 NPM-D3A)
-- =====================================================================
insert into maint_task_library (task_code, machine_type, task_name_zh, task_name_en, frequency, estimated_minutes, skill_level, safety_required, is_critical_path, description_zh, description_en, tools_required, parts_may_need) values
('MNT-PNP-001', 'mounter', '吸嘴清洁与检查', 'Nozzle Cleaning & Inspection', 'shift', 20, 'operator', false, true, '使用超声波清洗吸嘴，检查吸嘴表面有无无锡渣、变形或堵塞', 'Clean nozzles in ultrasonic bath; inspect for solder residue, deformation, blockage', '超声波清洗机, 40x显微镜', '吸嘴 (Nozzle)'),
('MNT-PNP-002', 'mounter', '气压/真空度检查', 'Air Pressure & Vacuum Check', 'shift', 10, 'operator', true, true, '检查气压是否在0.5-0.7MPa范围，真空度是否正常', 'Check air pressure 0.5-0.7MPa, verify vacuum level', '气压表, 真空表', null),
('MNT-PNP-003', 'mounter', 'feeder供料器检查', 'Feeder Check', 'shift', 15, 'operator', false, false, '检查料带是否正常推进，有无歪斜或卡料', 'Verify tape feeding smoothly, no skew or jam', null, 'feeder弹簧'),
('MNT-PNP-004', 'mounter', '贴装头运行状态听声检查', 'Mounting Head Sound Check', 'shift', 10, 'operator', true, true, '听贴装头运行声音，辨别有无异响或异常振动', 'Listen for abnormal noise or vibration from mount head', null, null),
('MNT-PNP-005', 'mounter', '轨道清洁', 'Track Cleaning', 'daily', 15, 'operator', false, false, '清洁导轨上的锡渣、灰尘和杂物', 'Clean solder residue, dust from tracks', '无尘布, 酒精', null),
('MNT-PNP-006', 'mounter', '相机光源检查', 'Camera & Light Source Check', 'daily', 10, 'operator', false, true, '检查光源亮度是否正常，有无闪烁', 'Verify light source brightness, check for flickering', null, '光源灯泡'),
('MNT-PNP-007', 'mounter', '安全门联锁测试', 'Safety Interlock Test', 'daily', 5, 'operator', true, true, '测试安全门开门是否立即停机，关门能否复位', 'Test safety door: opens → emergency stop, closes → reset', null, null),
('MNT-PNP-008', 'mounter', '丝杠润滑检查', 'Ball Screw Lubrication Check', 'weekly', 20, 'technician', false, true, '检查丝杠润滑脂状况，有无干摩擦', 'Check ball screw lubrication grease condition', '润滑脂枪', '润滑脂'),
('MNT-PNP-009', 'mounter', '皮带张力检查', 'Belt Tension Check', 'weekly', 15, 'technician', false, false, '检查传动皮带张力，有无明显松弛或磨损', 'Check belt tension and wear', null, '皮带'),
('MNT-PNP-010', 'mounter', '贴装精度校验', 'Placement Accuracy Calibration', 'weekly', 45, 'technician', false, true, '运行精度测试程序，验证偏移≤0.05mm', 'Run accuracy test: placement offset ≤ 0.05mm', '精度测试板', null),
('MNT-PNP-011', 'mounter', '吸取位置教正', 'Pick-up Position Teaching', 'weekly', 30, 'technician', false, true, '测试吸取教正，确认吸取成功率≥99.5%', 'Test pickup teaching, success rate ≥ 99.5%', null, null),
('MNT-PNP-012', 'mounter', '运动模组温度检测', 'Motor Module Temp Check', 'weekly', 15, 'technician', true, true, '用手持测温仪检测运动模组温度，检查过热', 'Measure motor module temp, check for overheating', '测温仪', null),
('MNT-PNP-013', 'mounter', '接地电阻测量', 'Ground Resistance Measurement', 'monthly', 20, 'technician', true, true, '测量设备接地电阻，确保≤1Ω', 'Measure ground resistance ≤ 1Ω', '接地电阻表', null),
('MNT-PNP-014', 'mounter', '真空泵检查与维护', 'Vacuum Pump Inspection', 'monthly', 30, 'technician', false, false, '检查真空泵油位、运行噪音和抽气性能', 'Check vacuum pump oil level, noise, suction performance', '真空泵油', '真空泵油, 密封圈'),
('MNT-PNP-015', 'mounter', '导轨磨损检查', 'Linear Guide Wear Check', 'quarterly', 40, 'technician', false, true, '检查X/Y导轨磨损情况，有无异常噪音或间隙', 'Check X/Y linear guides for wear, noise, clearance', null, '导轨滑块'),
('MNT-PNP-016', 'mounter', '马达皮带更换', 'Motor Belt Replacement', '半年度', 60, 'technician', false, false, '更换传动马达皮带，检查张紧轮', 'Replace motor belt, check tensioner pulley', '皮带', '马达皮带, 张紧轮轴承'),
('MNT-PNP-017', 'mounter', '全面精度校准', 'Full Accuracy Calibration', '年度', 90, 'engineer', false, true, '工程师全面校准贴装精度，更新补偿值', 'Engineer full calibration of placement accuracy', '精密测试板, 坐标测量仪', null);

insert into wear_parts_reference (machine_type, part_name_zh, part_name_en, typical_lifetime_zh, typical_lifetime_en, replacement_frequency, is_safety_critical) values
('mounter', '吸嘴 (各种规格)', 'Nozzles (various sizes)', '约5000-10000小时', '5000-10000 hours', '每3-6个月或根据磨损', true),
('mounter', '供料器弹簧', 'Feeder Spring', '约6个月', '6 months', '每半年', false),
('mounter', '马达传动皮带', 'Motor Drive Belt', '约1年', '1 year', '每年', false),
('mounter', '导轨滑块', 'Linear Guide Block', '约2-3年', '2-3 years', '视磨损情况', false),
('mounter', '真空泵油', 'Vacuum Pump Oil', '每500小时', 'Every 500 hours', '每3个月', false),
('mounter', '过滤器滤芯', 'Filter Element', '每6个月', '6 months', '每半年', false),
('mounter', '安全传感器', 'Safety Sensor', '视情况', 'Varies', '失效即换', true);

-- =====================================================================
-- 2. 回流焊 / REFLOW OVEN
-- =====================================================================
insert into maint_task_library (task_code, machine_type, task_name_zh, task_name_en, frequency, estimated_minutes, skill_level, safety_required, is_critical_path, description_zh, description_en, tools_required, parts_may_need) values
('MNT-RFL-001', 'reflow', '炉温曲线记录检查', 'Reflow Profile Review', 'shift', 15, 'operator', false, true, '检查今日炉温曲线是否在标准范围内', 'Review todays reflow profile is within spec', '炉温测试仪', null),
('MNT-RFL-002', 'reflow', '传送带速度检查', 'Conveyor Speed Check', 'shift', 10, 'operator', false, false, '核对传送带速度是否符合设定值±5%', 'Verify conveyor speed within ±5% of setpoint', null, null),
('MNT-RFL-003', 'reflow', '传送带清洁', 'Conveyor Cleaning', 'shift', 15, 'operator', false, false, '清洁传送带表面杂物和残留锡膏', 'Clean conveyor surface, remove debris and solder residue', '刮刀, 无尘布', null),
('MNT-RFL-004', 'reflow', '热电偶温度校准', 'Thermocouple Calibration', 'daily', 20, 'technician', true, true, '检查各加热区实际温度与设定值偏差是否≤±3°C', 'Check each zone actual vs set temp deviation ≤ ±3°C', '炉温测试仪', null),
('MNT-RFL-005', 'reflow', '冷却区温度检查', 'Cooling Zone Temp Check', 'daily', 10, 'operator', false, true, '检查冷却区温度是否正常冷却至室温', 'Verify cooling zone cools to near room temperature', null, null),
('MNT-RFL-006', 'reflow', '紧急停止按钮测试', 'Emergency Stop Test', 'daily', 5, 'operator', true, true, '测试紧急停止按钮是否能在按下后立即停机', 'Test emergency stop button stops machine immediately', null, null),
('MNT-RFL-007', 'reflow', '助焊剂残留清洁', 'Flux Residue Cleaning', 'daily', 20, 'operator', false, false, '清洁炉腔内助焊剂残留', 'Clean flux residue inside reflow chamber', '炉膛清洁刷', null),
('MNT-RFL-008', 'reflow', '氮气压力检查(氮气炉)', 'Nitrogen Pressure Check (N2 Oven)', 'daily', 10, 'operator', true, false, '检查氮气压力是否符合工艺要求', 'Check nitrogen pressure meets process requirements', '氮气压力表', null),
('MNT-RFL-009', 'reflow', '加热管升温速率测试', 'Heater Heating Rate Test', 'weekly', 40, 'technician', false, true, '检测各加热管升温速率是否符合规格', 'Test each heater tube heating rate meets spec', '炉温测试仪', '加热管'),
('MNT-RFL-010', 'reflow', '冷却风扇运转检查', 'Cooling Fan Operation Check', 'weekly', 15, 'technician', false, true, '听冷却风扇声音，检查有无异响或停转', 'Listen for abnormal noise, check if any fan stopped', null, '冷却风扇'),
('MNT-RFL-011', 'reflow', '炉膛密封性检查', 'Chamber Seal Inspection', 'weekly', 20, 'technician', false, true, '检查炉膛门密封条是否完好，有无热泄漏', 'Check chamber door seal for damage or heat leak', null, '密封条'),
('MNT-RFL-012', 'reflow', '热电偶精度校验', 'Thermocouple Accuracy Calibration', 'monthly', 60, 'engineer', true, true, '使用标准温度计对比热电偶读数，误差>3°C则更换', 'Compare thermocouple with standard thermometer; replace if error >3°C', '标准温度计', '热电偶'),
('MNT-RFL-013', 'reflow', '传送带链条润滑', 'Conveyor Chain Lubrication', 'monthly', 30, 'technician', false, false, '对传送带链条进行润滑', 'Lubricate conveyor chain', '链条润滑油', '链条润滑油'),
('MNT-RFL-014', 'reflow', '加热管更换', 'Heating Element Replacement', '半年度', 90, 'engineer', false, false, '更换老化加热管，检查接线端子', 'Replace aging heater elements, check terminals', '加热管', '加热管, 接线端子'),
('MNT-RFL-015', 'reflow', '热风循环马达检查', 'Hot Air Circulation Motor Check', '半年度', 60, 'engineer', false, false, '检查热风循环马达运转状态和电流', 'Check hot air circulation motor operation and current', null, '循环马达'),
('MNT-RFL-016', 'reflow', '全面炉温曲线校准', 'Full Reflow Profile Calibration', '年度', 120, 'engineer', false, true, '使用标准板做完整炉温曲线测试和校准', 'Full reflow profile test and calibration with standard board', '标准测试板, 炉温测试仪', null);

insert into wear_parts_reference (machine_type, part_name_zh, part_name_en, typical_lifetime_zh, typical_lifetime_en, replacement_frequency, is_safety_critical) values
('reflow', '热电偶', 'Thermocouple', '约1-2年', '1-2 years', '每年或按需', true),
('reflow', '加热管', 'Heating Element', '约2-3年', '2-3 years', '视情况', false),
('reflow', '冷却风扇', 'Cooling Fan', '约2年', '2 years', '每2年', false),
('reflow', '炉膛密封条', 'Chamber Seal', '约1年', '1 year', '每年', false),
('reflow', '传送带链条', 'Conveyor Chain', '约3年', '3 years', '视磨损', false),
('reflow', '热风循环马达', 'Hot Air Circulation Motor', '约5年', '5 years', '视情况', false);

-- =====================================================================
-- 3. 锡膏印刷机 / SOLDER PASTE PRINTER
-- =====================================================================
insert into maint_task_library (task_code, machine_type, task_name_zh, task_name_en, frequency, estimated_minutes, skill_level, safety_required, is_critical_path, description_zh, description_en, tools_required, parts_may_need) values
('MNT-PRT-001', 'printer', '钢网清洁', 'Stencil Cleaning', 'shift', 15, 'operator', false, true, '清洁钢网底部和网孔，去除残留锡膏', 'Clean stencil bottom and apertures, remove solder paste', '钢网清洗机, 无尘纸', null),
('MNT-PRT-002', 'printer', '刮刀压力与速度检查', 'Squeegee Pressure & Speed Check', 'shift', 10, 'operator', false, true, '核对刮刀压力和速度是否符合工艺设定', 'Verify squeegee pressure and speed per process spec', null, null),
('MNT-PRT-003', 'printer', 'PCB夹具检查', 'PCB Clamping Fixture Check', 'shift', 10, 'operator', false, false, '检查夹具是否松动或过度磨损', 'Check fixtures for looseness or excessive wear', null, '夹具垫片'),
('MNT-PRT-004', 'printer', '锡膏量检查与补充', 'Solder Paste Level Check & Top-up', 'shift', 10, 'operator', false, false, '检查钢网下锡膏覆盖面积，及时补充新锡膏', 'Check paste coverage ≥80%, top up with fresh paste', null, '锡膏'),
('MNT-PRT-005', 'printer', '印刷偏移首件检查', 'First Board Print Offset Check', 'shift', 15, 'operator', false, true, '首件AOI或目视检查印刷偏移，标准≤0.1mm', 'First article: check print offset ≤0.1mm by AOI or visual', 'AOI/放大镜', null),
('MNT-PRT-006', 'printer', '轨道清洁', 'Track Cleaning', 'daily', 15, 'operator', false, false, '清洁传送轨道上的杂物和锡渣', 'Clean track debris and solder residue', '无尘布', null),
('MNT-PRT-007', 'printer', '丝杠润滑检查', 'Ball Screw Lubrication Check', 'weekly', 20, 'technician', false, false, '检查丝杠润滑状态，及时补充润滑脂', 'Check ball screw lubrication, add grease if needed', '润滑脂', '润滑脂'),
('MNT-PRT-008', 'printer', '导轨磨损检查', 'Linear Guide Wear Check', 'weekly', 20, 'technician', false, true, '检查导轨表面有无明显磨损或划痕', 'Check linear guides for wear or scratches', null, '导轨'),
('MNT-PRT-009', 'printer', '钢网张力测量', 'Stencil Tension Measurement', 'weekly', 20, 'technician', false, true, '使用张力计测量钢网张力是否符合规格', 'Measure stencil tension with tension meter', '张力计', null),
('MNT-PRT-010', 'printer', '印刷精度测试', 'Print Accuracy Test', 'weekly', 30, 'technician', false, true, '用标准PCB做印刷测试，偏移≤0.1mm', 'Test print accuracy with standard PCB: offset ≤0.1mm', '标准测试PCB', null),
('MNT-PRT-011', 'printer', '刮刀垫片更换', 'Squeegee Blade Rubber Replacement', 'monthly', 30, 'technician', false, false, '更换磨损的刮刀橡胶垫片', 'Replace worn squeegee blade rubber', '刮刀橡胶', '刮刀橡胶'),
('MNT-PRT-012', 'printer', '马达皮带检查', 'Motor Belt Inspection', 'monthly', 15, 'technician', false, false, '检查传动皮带张力，磨损严重则更换', 'Check drive belt tension; replace if worn', null, '马达皮带'),
('MNT-PRT-013', 'printer', '视觉系统校准', 'Vision System Calibration', 'quarterly', 45, 'engineer', false, true, '校准PCB Mark识别和焊膏检测视觉系统', 'Calibrate PCB Mark recognition and paste inspection vision', '校准板', null),
('MNT-PRT-014', 'printer', '钢网更换与张力调整', 'Stencil Replacement & Tension Adjust', '半年度', 60, 'technician', false, false, '更换老化钢网，重新调整张力', 'Replace aged stencil, re-tension', '新钢网', '钢网'),
('MNT-PRT-015', 'printer', '全面精度校准', 'Full Print Accuracy Calibration', '年度', 90, 'engineer', false, true, '工程师全面校准印刷精度', 'Engineer full print accuracy calibration', '标准PCB, 坐标仪', null);

insert into wear_parts_reference (machine_type, part_name_zh, part_name_en, typical_lifetime_zh, typical_lifetime_en, replacement_frequency, is_safety_critical) values
('printer', '钢网', 'Stencil', '约6-12个月', '6-12 months', '按需(按产品换型)', false),
('printer', '刮刀橡胶垫片', 'Squeegee Blade Rubber', '约3个月', '3 months', '每季度', false),
('printer', '马达传动皮带', 'Motor Drive Belt', '约1年', '1 year', '每年', false),
('printer', '导轨滑块', 'Linear Guide Block', '约2年', '2 years', '视磨损', false),
('printer', '夹具垫片', 'Fixture Gasket', '约3个月', '3 months', '每季度', false),
('printer', '过滤器', 'Filter', '每3个月', '3 months', '每季度', false);

-- =====================================================================
-- 4. SPI 锡膏检测机
-- =====================================================================
insert into maint_task_library (task_code, machine_type, task_name_zh, task_name_en, frequency, estimated_minutes, skill_level, safety_required, is_critical_path, description_zh, description_en, tools_required, parts_may_need) values
('MNT-SPI-001', 'SPI', '光学镜头清洁', 'Optical Lens Cleaning', 'shift', 10, 'operator', false, true, '清洁光学镜头和投射光栅上的灰尘', 'Clean optical lens and projection grating dust', '镜头纸, 吹气球', null),
('MNT-SPI-002', 'SPI', '传送机构自检', 'Conveyor Self-Test', 'shift', 10, 'operator', false, false, '运行传送机构自检，确认运行平稳无卡顿', 'Run conveyor self-test, verify smooth operation', null, null),
('MNT-SPI-003', 'SPI', '基准板校准', 'Benchmark Board Calibration', 'daily', 20, 'technician', false, true, '使用标准基准板进行校准验证', 'Calibrate using standard benchmark board', '标准基准板', null),
('MNT-SPI-004', 'SPI', '光源亮度检测', 'Light Source Brightness Check', 'daily', 10, 'operator', false, true, '检查光源亮度是否正常，有无衰减', 'Check light source brightness and intensity', null, '光源灯泡'),
('MNT-SPI-005', 'SPI', '测量重复性测试', 'Measurement Repeatability Test', 'weekly', 30, 'technician', false, true, '对同一PCB重复测量3次，验证重复性误差≤5%', 'Test same board 3 times: repeatability error ≤5%', '标准测试PCB', null),
('MNT-SPI-006', 'SPI', '清洁光路组件', 'Optical Path Cleaning', 'weekly', 20, 'operator', false, false, '清洁反光碗、分光片等光路组件', 'Clean reflector, beam splitter and optical path', '镜头纸', null),
('MNT-SPI-007', 'SPI', 'XY平台精度检查', 'XY Platform Accuracy Check', 'monthly', 40, 'technician', false, true, '检测XY平台定位精度', 'Check XY platform positioning accuracy', '测试靶标', '导轨'),
('MNT-SPI-008', 'SPI', '光源灯泡更换', 'Light Source Bulb Replacement', '每季度', 30, 'technician', false, false, '更换达到使用寿命的光源灯泡', 'Replace light source bulbs at end of life', '光源灯泡', '光源灯泡'),
('MNT-SPI-009', 'SPI', '全面系统验证', 'Full System Verification', '半年度', 90, 'engineer', false, true, '工程师执行完整系统精度验证和校准', 'Engineer full system accuracy verification', '标准测试板', null);

insert into wear_parts_reference (machine_type, part_name_zh, part_name_en, typical_lifetime_zh, typical_lifetime_en, replacement_frequency, is_safety_critical) values
('SPI', '光源灯泡', 'Light Source Bulb', '约1000-2000小时', '1000-2000 hours', '每季度或按需', false),
('SPI', '光学镜头', 'Optical Lens', '约2-3年', '2-3 years', '按需', false),
('SPI', '传送皮带', 'Conveyor Belt', '约1年', '1 year', '每年', false),
('SPI', '滤光片', 'Filter Glass', '约2年', '2 years', '每2年', false);

-- =====================================================================
-- 5. AOI 自动光学检测机
-- =====================================================================
insert into maint_task_library (task_code, machine_type, task_name_zh, task_name_en, frequency, estimated_minutes, skill_level, safety_required, is_critical_path, description_zh, description_en, tools_required, parts_may_need) values
('MNT-AOI-001', 'AOI', '光学镜头清洁', 'Optical Lens Cleaning', 'shift', 10, 'operator', false, true, '清洁相机镜头和光源反光罩', 'Clean camera lens and light reflector', '镜头纸, 吹气球', null),
('MNT-AOI-002', 'AOI', '光源亮度自检', 'Light Source Self-Test', 'shift', 10, 'operator', false, true, '运行光源自检，检查有无灯泡不亮或闪烁', 'Run light source self-test, check for dim or flickering bulbs', null, '光源灯泡'),
('MNT-AOI-003', 'AOI', '传送机构检查', 'Conveyor Mechanism Check', 'shift', 10, 'operator', false, false, '检查PCB传送是否平稳，有无卡顿', 'Verify PCB conveyor runs smoothly', null, null),
('MNT-AOI-004', 'AOI', '基准板校准', 'Benchmark Board Calibration', 'daily', 20, 'technician', false, true, '用AOI标准板进行精度校准', 'Calibrate using AOI standard board', 'AOI校准板', null),
('MNT-AOI-005', 'AOI', '软件系统状态检查', 'Software System Status Check', 'daily', 10, 'operator', false, false, '查看系统提示和日志，有无报错', 'Check system logs for errors or warnings', null, null),
('MNT-AOI-006', 'AOI', '检测灵敏度校验', 'Detection Sensitivity Verification', 'daily', 15, 'operator', false, true, '运行标准测试板验证检测灵敏度设定', 'Run standard test board to verify detection sensitivity', 'AOI测试板', null),
('MNT-AOI-007', 'AOI', '相机焦距与曝光校准', 'Camera Focus & Exposure Calibration', 'weekly', 30, 'technician', false, true, '校准相机焦距、曝光参数', 'Calibrate camera focus and exposure', '校准板', null),
('MNT-AOI-008', 'AOI', 'XY运动平台检查', 'XY Stage Check', 'weekly', 20, 'technician', false, true, '检查XY平台运动是否顺畅，有无异响', 'Check XY stage moves smoothly without noise', null, null),
('MNT-AOI-009', 'AOI', '光源灯泡更换', 'Light Source Bulb Replacement', '每季度', 30, 'technician', false, false, '更换老化光源灯泡', 'Replace aging light source bulbs', '光源灯泡', '光源灯泡'),
('MNT-AOI-010', 'AOI', '漏检率测试', 'False Negative Rate Test', 'monthly', 45, 'technician', false, true, '用已知缺陷板测试，漏检率应<0.5%', 'Test with known defect board: false negative <0.5%', '缺陷测试板', null),
('MNT-AOI-011', 'AOI', '全面精度校准', 'Full Accuracy Calibration', '半年度', 90, 'engineer', false, true, '工程师执行完整系统精度校准', 'Engineer full system accuracy calibration', '标准校准板', null);

insert into wear_parts_reference (machine_type, part_name_zh, part_name_en, typical_lifetime_zh, typical_lifetime_en, replacement_frequency, is_safety_critical) values
('AOI', '光源灯泡', 'Light Source Bulb', '约1000-2000小时', '1000-2000 hours', '每季度', false),
('AOI', '相机', 'Camera', '约5年', '5 years', '按需', false),
('AOI', '传送皮带', 'Conveyor Belt', '约1年', '1 year', '每年', false),
('AOI', '滤光片', 'Filter Glass', '约2年', '2 years', '每2年', false);

-- =====================================================================
-- 6. PCB 激光刻蚀机 / PCB LASER
-- =====================================================================
insert into maint_task_library (task_code, machine_type, task_name_zh, task_name_en, frequency, estimated_minutes, skill_level, safety_required, is_critical_path, description_zh, description_en, tools_required, parts_may_need) values
('MNT-LAS-001', 'pcb_laser', '激光头清洁', 'Laser Head Cleaning', 'shift', 15, 'operator', false, true, '清洁激光头镜片和出光口', 'Clean laser head lens and output port', '镜头纸, 吹气球', null),
('MNT-LAS-002', 'pcb_laser', '激光功率检查', 'Laser Power Check', 'shift', 10, 'operator', false, true, '检查激光功率是否稳定在设定范围', 'Verify laser power is stable within set range', '激光功率计', null),
('MNT-LAS-003', 'pcb_laser', '工作平台清洁', 'Work Platform Cleaning', 'daily', 15, 'operator', false, false, '清洁工作平台和导轨', 'Clean work platform and guide rails', '无尘布', null),
('MNT-LAS-004', 'pcb_laser', '冷却系统检查', 'Cooling System Check', 'daily', 10, 'operator', true, true, '检查冷却水循环是否正常，有无漏水', 'Check cooling water circulation, no leaks', null, null),
('MNT-LAS-005', 'pcb_laser', '安全联锁检查', 'Safety Interlock Check', 'daily', 5, 'operator', true, true, '测试安全门联锁是否正常', 'Test safety door interlock', null, null),
('MNT-LAS-006', 'pcb_laser', '激光管使用寿命检查', 'Laser Tube Life Check', 'weekly', 15, 'technician', false, true, '记录激光管使用时间，接近上限前预警', 'Record laser tube hours; alert when approaching limit', null, '激光管'),
('MNT-LAS-007', 'pcb_laser', '光路校准', 'Optical Path Calibration', 'monthly', 45, 'engineer', false, true, '校准激光光路，确保聚焦准确', 'Calibrate laser optical path, ensure correct focus', '功率计, 校准靶', null),
('MNT-LAS-008', 'pcb_laser', '冷却水更换', 'Cooling Water Replacement', '每季度', 30, 'technician', false, false, '更换冷却水，清洁水箱', 'Replace cooling water, clean water tank', '冷却水', '冷却水, 过滤器'),
('MNT-LAS-009', 'pcb_laser', '激光管更换', 'Laser Tube Replacement', '年度', 90, 'engineer', true, false, '更换达到寿命的激光管', 'Replace laser tube at end of life', '激光管', '激光管'),
('MNT-LAS-010', 'pcb_laser', '导轨润滑与磨损检查', 'Guide Rail Lubrication & Wear Check', 'monthly', 30, 'technician', false, false, '润滑导轨，检查磨损情况', 'Lubricate guide rails, check wear', '润滑脂', '导轨滑块');

insert into wear_parts_reference (machine_type, part_name_zh, part_name_en, typical_lifetime_zh, typical_lifetime_en, replacement_frequency, is_safety_critical) values
('pcb_laser', '激光管', 'Laser Tube', '约3000-5000小时', '3000-5000 hours', '按小时或按需', true),
('pcb_laser', '激光镜片', 'Laser Mirror/Lens', '约1年', '1 year', '每年', false),
('pcb_laser', '冷却水', 'Cooling Water', '每季度', 'Quarterly', '每季度', false),
('pcb_laser', '导轨滑块', 'Guide Rail Block', '约2年', '2 years', '按需', false);

-- =====================================================================
-- 7. AI 插件机 / AI INSERTION
-- =====================================================================
insert into maint_task_library (task_code, machine_type, task_name_zh, task_name_en, frequency, estimated_minutes, skill_level, safety_required, is_critical_path, description_zh, description_en, tools_required, parts_may_need) values
('MNT-AI-001', 'ai_insert', '吸取头清洁与检查', 'Pick-up Head Cleaning', 'shift', 15, 'operator', false, true, '清洁吸取头，检查有无磨损或变形', 'Clean pick-up head, check for wear or deformation', null, '吸取头'),
('MNT-AI-002', 'ai_insert', '气源压力检查', 'Air Pressure Check', 'shift', 10, 'operator', true, true, '检查气压是否在正常范围', 'Check air pressure within spec', '气压表', null),
('MNT-AI-003', 'ai_insert', '插件位置精度检查', 'Insertion Position Accuracy Check', 'shift', 15, 'operator', false, true, '检查插件位置是否准确，有无歪斜', 'Check component insertion position accuracy', null, null),
('MNT-AI-004', 'ai_insert', '元器件供料器检查', 'Component Feeder Check', 'daily', 20, 'operator', false, false, '检查各类供料器是否正常供料', 'Check all component feeders feeding properly', null, '供料器弹簧'),
('MNT-AI-005', 'ai_insert', '轨道清洁与检查', 'Track Cleaning & Check', 'daily', 15, 'operator', false, false, '清洁传送轨道，检查PCB夹具', 'Clean track, check PCB clamps', '无尘布', null),
('MNT-AI-006', 'ai_insert', '剪脚机构检查', 'Cut Foot Mechanism Check', 'weekly', 20, 'technician', false, true, '检查引脚剪断机构是否正常', 'Check lead cutting mechanism', null, '切脚刀片'),
('MNT-AI-007', 'ai_insert', '马达与皮带检查', 'Motor & Belt Check', 'weekly', 20, 'technician', false, false, '检查传动马达和皮带状态', 'Check drive motor and belt condition', null, '皮带'),
('MNT-AI-008', 'ai_insert', '润滑系统检查', 'Lubrication System Check', 'weekly', 15, 'technician', false, false, '检查自动润滑系统是否正常供油', 'Check auto lubrication system feeding oil', '润滑油', '润滑油'),
('MNT-AI-009', 'ai_insert', '弯曲矫正机构检查', 'Lead Straightening Check', 'monthly', 30, 'technician', false, true, '检查元器件引脚弯曲矫正机构', 'Check component lead straightening mechanism', null, null),
('MNT-AI-010', 'ai_insert', '安全装置检查', 'Safety Device Check', 'monthly', 15, 'technician', true, true, '检查安全光栅、门联锁等安全装置', 'Check safety light curtain and door interlocks', null, null);

insert into wear_parts_reference (machine_type, part_name_zh, part_name_en, typical_lifetime_zh, typical_lifetime_en, replacement_frequency, is_safety_critical) values
('ai_insert', '吸取头', 'Pick-up Head', '约6个月', '6 months', '每半年', false),
('ai_insert', '供料器弹簧', 'Feeder Spring', '约6个月', '6 months', '每半年', false),
('ai_insert', '切脚刀片', 'Cut Foot Blade', '约3个月', '3 months', '每季度', false),
('ai_insert', '马达皮带', 'Motor Belt', '约1年', '1 year', '每年', false),
('ai_insert', '安全光栅', 'Safety Light Curtain', '约5年', '5 years', '按需', true);

-- =====================================================================
-- 8. 波峰焊 / WAVE SOLDER
-- =====================================================================
insert into maint_task_library (task_code, machine_type, task_name_zh, task_name_en, frequency, estimated_minutes, skill_level, safety_required, is_critical_path, description_zh, description_en, tools_required, parts_may_need) values
('MNT-WAV-001', 'wave_solder', '锡炉温度检查', 'Solder Pot Temperature Check', 'shift', 15, 'operator', false, true, '检查锡炉温度是否在设定范围', 'Check solder pot temperature within spec', '测温仪', null),
('MNT-WAV-002', 'wave_solder', '助焊剂喷涂检查', 'Flux Spray Check', 'shift', 10, 'operator', false, true, '检查助焊剂喷涂是否均匀', 'Check flux spray uniformity', null, null),
('MNT-WAV-003', 'wave_solder', '传送带速度检查', 'Conveyor Speed Check', 'shift', 10, 'operator', false, false, '核对传送速度是否符合工艺要求', 'Verify conveyor speed per process spec', null, null),
('MNT-WAV-004', 'wave_solder', '锡渣清理', 'Solder Dross Removal', 'daily', 20, 'operator', false, false, '清理锡炉表面锡渣', 'Remove solder dross from pot surface', '锡渣铲', null),
('MNT-WAV-005', 'wave_solder', '锡炉锡量检查', 'Solder Level Check', 'daily', 10, 'operator', false, true, '检查锡炉锡量，及时补充', 'Check solder level, top up if needed', null, '锡条'),
('MNT-WAV-006', 'wave_solder', '预热区温度检查', 'Preheat Zone Temp Check', 'daily', 10, 'operator', false, false, '检查预热区温度曲线', 'Check preheat zone temperature profile', '测温仪', null),
('MNT-WAV-007', 'wave_solder', '锡成分分析', 'Solder Composition Analysis', 'weekly', 40, 'technician', false, true, '化验锡炉锡成分，及时补锡或换锡', 'Test solder composition; add锡 or replace if contaminated', '成分分析仪', '锡条'),
('MNT-WAV-008', 'wave_solder', '波峰形状调整', 'Wave Shape Adjustment', 'weekly', 30, 'technician', false, true, '调整波峰高度和形状', 'Adjust wave height and shape', null, null),
('MNT-WAV-009', 'wave_solder', '锡炉清洁与保养', 'Solder Pot Cleaning & Maintenance', 'monthly', 60, 'technician', false, false, '清洁锡炉内壁，更换氧化物污染锡', 'Clean pot interior, replace contaminated solder', '锡条', '锡条, 助焊剂'),
('MNT-WAV-010', 'wave_solder', '发热管检查', 'Heater Check', 'quarterly', 40, 'technician', false, false, '检查锡炉发热管状态', 'Check solder pot heater condition', null, '发热管'),
('MNT-WAV-011', 'wave_solder', '传送链润滑', 'Conveyor Chain Lubrication', 'monthly', 20, 'technician', false, false, '润滑传送链条', 'Lubricate conveyor chain', '链条油', '链条油');

insert into wear_parts_reference (machine_type, part_name_zh, part_name_en, typical_lifetime_zh, typical_lifetime_en, replacement_frequency, is_safety_critical) values
('wave_solder', '锡条', 'Solder Bar', '按污染程度', 'Varies with contamination', '按需(每月检测)', false),
('wave_solder', '发热管', 'Heater', '约3年', '3 years', '每3年', false),
('wave_solder', '助焊剂喷嘴', 'Flux Nozzle', '约6个月', '6 months', '每半年', false),
('wave_solder', '传送链条', 'Conveyor Chain', '约2年', '2 years', '每2年', false),
('wave_solder', '波峰叶片', 'Wave Blade', '约1年', '1 year', '每年', false);

-- =====================================================================
-- 9. ICT 在线测试仪
-- =====================================================================
insert into maint_task_library (task_code, machine_type, task_name_zh, task_name_en, frequency, estimated_minutes, skill_level, safety_required, is_critical_path, description_zh, description_en, tools_required, parts_may_need) values
('MNT-ICT-001', 'ICT', '气动探针压力检查', 'Pneumatic Probe Pressure Check', 'shift', 10, 'operator', false, true, '检查气动探针压力是否正常', 'Check pneumatic probe pressure', '气压表', null),
('MNT-ICT-002', 'ICT', '治具清洁', 'Fixture Cleaning', 'shift', 15, 'operator', false, false, '清洁测试治具和探针', 'Clean test fixture and probes', '无尘布, 酒精', null),
('MNT-ICT-003', 'ICT', '系统自检', 'System Self-Test', 'daily', 10, 'operator', false, true, '运行系统自检程序', 'Run system self-test', null, null),
('MNT-ICT-004', 'ICT', '接地检查', 'Ground Check', 'daily', 10, 'operator', true, true, '检查设备接地是否良好', 'Check equipment ground connection', '万用表', null),
('MNT-ICT-005', 'ICT', '探针磨损检查', 'Probe Wear Check', 'weekly', 30, 'technician', false, true, '检查探针磨损情况，接触不良及时更换', 'Check probe wear; replace if poor contact', 'ICT治具', '探针'),
('MNT-ICT-006', 'ICT', '校准板校验', 'Calibration Board Verification', 'monthly', 30, 'technician', false, true, '用校准板验证测试精度', 'Verify test accuracy with calibration board', '校准板', null),
('MNT-ICT-007', 'ICT', '气路过滤器更换', 'Air Filter Replacement', 'quarterly', 20, 'technician', false, false, '更换气路过滤器', 'Replace air line filter', '过滤器', '过滤器'),
('MNT-ICT-008', 'ICT', '治具探针更换', 'Fixture Probe Replacement', '每季度', 45, 'technician', false, false, '更换老化或接触不良的探针', 'Replace worn or bad contact probes', '探针', '探针');

insert into wear_parts_reference (machine_type, part_name_zh, part_name_en, typical_lifetime_zh, typical_lifetime_en, replacement_frequency, is_safety_critical) values
('ICT', '测试探针', 'Test Probe', '约1-3个月', '1-3 months', '按接触不良频率', false),
('ICT', '真空吸嘴', 'Vacuum Nozzle', '约6个月', '6 months', '每半年', false),
('ICT', '气路过滤器', 'Air Filter', '每季度', 'Quarterly', '每季度', false),
('ICT', 'PCB连接器', 'PCB Connector', '约1年', '1 year', '每年', false);

-- =====================================================================
-- 10. FCT 功能测试仪
-- =====================================================================
insert into maint_task_library (task_code, machine_type, task_name_zh, task_name_en, frequency, estimated_minutes, skill_level, safety_required, is_critical_path, description_zh, description_en, tools_required, parts_may_need) values
('MNT-FCT-001', 'FCT', '测试夹具检查', 'Test Fixture Check', 'shift', 15, 'operator', false, false, '检查测试夹具连接是否可靠', 'Check test fixture connections', null, null),
('MNT-FCT-002', 'FCT', '电源输出检查', 'Power Supply Output Check', 'shift', 10, 'operator', false, true, '检测各路电源输出是否正常', 'Check each power supply output', '万用表', null),
('MNT-FCT-003', 'FCT', '系统软件自检', 'Software Self-Test', 'daily', 10, 'operator', false, false, '运行软件自检，查看错误日志', 'Run software self-test, check error logs', null, null),
('MNT-FCT-004', 'FCT', '接线端子检查', 'Terminal Connection Check', 'weekly', 20, 'technician', false, false, '检查所有接线端子是否松动', 'Check all terminal connections for looseness', '螺丝刀', '端子'),
('MNT-FCT-005', 'FCT', '仪表校准', 'Instrument Calibration', 'quarterly', 60, 'engineer', false, true, '对测试仪表进行全面校准', 'Full calibration of test instruments', '标准信号源', null),
('MNT-FCT-006', 'FCT', '风扇与散热检查', 'Fan & Heat Dissipation Check', 'monthly', 20, 'technician', false, false, '检查设备风扇和散热片', 'Check equipment fans and heatsinks', null, '风扇');

insert into wear_parts_reference (machine_type, part_name_zh, part_name_en, typical_lifetime_zh, typical_lifetime_en, replacement_frequency, is_safety_critical) values
('FCT', '测试夹具', 'Test Fixture', '约6-12个月', '6-12 months', '按需', false),
('FCT', '风扇', 'Fan', '约2年', '2 years', '每2年', false),
('FCT', '接线端子', 'Terminal Block', '约3年', '3 years', '按需', false);

-- =====================================================================
-- 11. 分板机 / DEPANEL
-- =====================================================================
insert into maint_task_library (task_code, machine_type, task_name_zh, task_name_en, frequency, estimated_minutes, skill_level, safety_required, is_critical_path, description_zh, description_en, tools_required, parts_may_need) values
('MNT-DEP-001', 'depanel', '刀片清洁与检查', 'Blade Cleaning & Inspection', 'shift', 15, 'operator', false, true, '清洁刀片，检查刃口有无崩刃或磨损', 'Clean blade, check edge for chipping or wear', '无尘布', null),
('MNT-DEP-002', 'depanel', '切割参数检查', 'Cutting Parameters Check', 'shift', 10, 'operator', false, true, '检查切割速度、深度等参数', 'Check cutting speed and depth parameters', null, null),
('MNT-DEP-003', 'depanel', 'PCB传送机构检查', 'PCB Conveyor Check', 'daily', 15, 'operator', false, false, '检查传送带有无跑偏或磨损', 'Check conveyor belt for deviation or wear', null, '传送皮带'),
('MNT-DEP-004', 'depanel', '安全光栅检查', 'Safety Light Curtain Check', 'daily', 5, 'operator', true, true, '测试安全光栅是否正常', 'Test safety light curtain operation', null, null),
('MNT-DEP-005', 'depanel', '刀片研磨或更换', 'Blade Grinding or Replacement', 'weekly', 40, 'technician', false, true, '研磨或更换钝化的刀片', 'Grind or replace dulled blade', '新刀片', '刀片'),
('MNT-DEP-006', 'depanel', '导轨润滑', 'Guide Rail Lubrication', 'weekly', 15, 'technician', false, false, '润滑切割机构导轨', 'Lubricate cutting mechanism guide rails', '润滑油', '润滑油'),
('MNT-DEP-007', 'depanel', '马达皮带检查', 'Motor Belt Check', 'monthly', 20, 'technician', false, false, '检查马达皮带张力与磨损', 'Check motor belt tension and wear', null, '马达皮带'),
('MNT-DEP-008', 'depanel', '切割精度检查', 'Cutting Accuracy Check', 'monthly', 30, 'technician', false, true, '测量分板尺寸精度是否在要求内', 'Measure panel size accuracy within spec', '卡尺', null);

insert into wear_parts_reference (machine_type, part_name_zh, part_name_en, typical_lifetime_zh, typical_lifetime_en, replacement_frequency, is_safety_critical) values
('depanel', '刀片', 'Blade', '约5000-10000刀次', '5000-10000 cuts', '按刀次或目视', true),
('depanel', '传送皮带', 'Conveyor Belt', '约6个月', '6 months', '每半年', false),
('depanel', '马达皮带', 'Motor Belt', '约1年', '1 year', '每年', false),
('depanel', '导轨', 'Guide Rail', '约2年', '2 years', '每2年', false);

-- =====================================================================
-- 12. 超声波清洗机 / ULTRASONIC CLEANER
-- =====================================================================
insert into maint_task_library (task_code, machine_type, task_name_zh, task_name_en, frequency, estimated_minutes, skill_level, safety_required, is_critical_path, description_zh, description_en, tools_required, parts_may_need) values
('MNT-ULT-001', 'ultrasonic', '清洗液液位检查', 'Cleaning Solution Level Check', 'shift', 10, 'operator', false, true, '检查清洗液液位，及时补充', 'Check cleaning solution level, top up', null, '清洗液'),
('MNT-ULT-002', 'ultrasonic', '超声波发生器自检', 'Ultrasonic Generator Self-Test', 'shift', 10, 'operator', false, true, '运行自检，听超声波是否正常', 'Run self-test, listen for normal ultrasonic sound', null, null),
('MNT-ULT-003', 'ultrasonic', '清洗篮清洁', 'Cleaning Basket Cleaning', 'daily', 15, 'operator', false, false, '清洁清洗篮内残渣', 'Clean residue from basket', '刷子', null),
('MNT-ULT-004', 'ultrasonic', '清洗液更换', 'Cleaning Solution Replacement', 'weekly', 30, 'operator', false, false, '更换清洗液，清洁槽体', 'Replace cleaning solution, clean tank', '清洗液', '清洗液, 过滤器'),
('MNT-ULT-005', 'ultrasonic', '超声波振子检查', 'Ultrasonic Transducer Check', 'monthly', 30, 'technician', false, true, '检查振子是否正常，有无损坏', 'Check transducers for damage', null, '振子'),
('MNT-ULT-006', 'ultrasonic', '加热系统检查', 'Heating System Check', 'monthly', 20, 'technician', false, false, '检查加热功能是否正常', 'Check heating system function', null, '加热管'),
('MNT-ULT-007', 'ultrasonic', '排水系统清洁', 'Drain System Cleaning', 'monthly', 20, 'operator', false, false, '清洁排水管路', 'Clean drain lines', null, null),
('MNT-ULT-008', 'ultrasonic', '超声波振子更换', 'Ultrasonic Transducer Replacement', '半年度', 60, 'engineer', false, false, '更换性能下降的振子', 'Replace degraded transducers', '振子', '振子');

insert into wear_parts_reference (machine_type, part_name_zh, part_name_en, typical_lifetime_zh, typical_lifetime_en, replacement_frequency, is_safety_critical) values
('ultrasonic', '清洗液', 'Cleaning Solution', '每周', 'Weekly', '每周', false),
('ultrasonic', '超声波振子', 'Ultrasonic Transducer', '约2-3年', '2-3 years', '每2年', false),
('ultrasonic', '加热管', 'Heating Tube', '约2年', '2 years', '每2年', false),
('ultrasonic', '密封圈', 'Seal Ring', '约6个月', '6 months', '每半年', false);

-- =====================================================================
-- 13. 老化和负载测试 / BURN-IN TESTER
-- =====================================================================
insert into maint_task_library (task_code, machine_type, task_name_zh, task_name_en, frequency, estimated_minutes, skill_level, safety_required, is_critical_path, description_zh, description_en, tools_required, parts_may_need) values
('MNT-BI-001', 'burnin', '温度监控检查', 'Temperature Monitor Check', 'shift', 10, 'operator', false, true, '检查老化箱温度是否在设定范围', 'Check burn-in chamber temperature within set range', '温度计', null),
('MNT-BI-002', 'burnin', '电源负载检查', 'Power Load Check', 'shift', 10, 'operator', false, true, '检查各路电源负载是否正常', 'Check each power load channel', '万用表', null),
('MNT-BI-003', 'burnin', '排气系统检查', 'Exhaust System Check', 'daily', 10, 'operator', true, false, '检查排风扇是否正常运转', 'Check exhaust fan running normally', null, null),
('MNT-BI-004', 'burnin', '安全门联锁', 'Safety Door Interlock', 'daily', 5, 'operator', true, true, '测试安全门联锁是否正常', 'Test safety door interlock', null, null),
('MNT-BI-005', 'burnin', '加热元件检查', 'Heating Element Check', 'weekly', 30, 'technician', false, true, '检查加热元件是否正常升温', 'Check heating elements heating properly', null, '加热管'),
('MNT-BI-006', 'burnin', '温度均匀性测试', 'Temperature Uniformity Test', 'monthly', 60, 'technician', false, true, '检测箱内温度均匀性', 'Test temperature uniformity inside chamber', '温度校准仪', null),
('MNT-BI-007', 'burnin', '排风扇更换', 'Exhaust Fan Replacement', '半年度', 40, 'technician', false, false, '更换达到寿命的排风扇', 'Replace aging exhaust fan', '排风扇', '排风扇'),
('MNT-BI-008', 'burnin', '加热管更换', 'Heating Element Replacement', '年度', 60, 'technician', false, false, '更换老化加热管', 'Replace aging heating elements', '加热管', '加热管');

insert into wear_parts_reference (machine_type, part_name_zh, part_name_en, typical_lifetime_zh, typical_lifetime_en, replacement_frequency, is_safety_critical) values
('burnin', '加热管', 'Heating Element', '约2-3年', '2-3 years', '每2年', false),
('burnin', '排风扇', 'Exhaust Fan', '约2年', '2 years', '每2年', false),
('burnin', '温度传感器', 'Temperature Sensor', '约2年', '2 years', '每2年', false),
('burnin', '密封门条', 'Door Seal', '约1年', '1 year', '每年', false);

-- =====================================================================
-- 14. 耐压测试仪 / HI-POT TESTER
-- =====================================================================
insert into maint_task_library (task_code, machine_type, task_name_zh, task_name_en, frequency, estimated_minutes, skill_level, safety_required, is_critical_path, description_zh, description_en, tools_required, parts_may_need) values
('MNT-HIP-001', 'hipot', '安全门联锁检查', 'Safety Door Interlock Check', 'shift', 5, 'operator', true, true, '测试安全门联锁，开门必须断电', 'Test door interlock: must cut power on open', null, null),
('MNT-HIP-002', 'hipot', '高压输出检查', 'High Voltage Output Check', 'shift', 10, 'operator', false, true, '检查高压输出是否正常稳定', 'Check high voltage output normal and stable', '高压表', null),
('MNT-HIP-003', 'hipot', '接地连续性检查', 'Ground Continuity Check', 'daily', 10, 'operator', true, true, '检查设备接地是否良好', 'Check equipment ground continuity', '接地电阻表', null),
('MNT-HIP-004', 'hipot', '校准有效期检查', 'Calibration Certificate Check', 'daily', 5, 'operator', false, true, '确认耐压仪在校准有效期内', 'Verify hipot tester within calibration validity', null, null),
('MNT-HIP-005', 'hipot', '高压线缆检查', 'High Voltage Cable Inspection', 'weekly', 20, 'technician', true, true, '检查高压线缆绝缘有无破损', 'Check HV cable insulation for damage', null, '高压线缆'),
('MNT-HIP-006', 'hipot', '耐压精度校准', 'Withstand Voltage Accuracy Calibration', '半年度', 60, 'engineer', false, true, '送校准机构校准耐压精度', 'Send to calibration lab for accuracy calibration', null, null),
('MNT-HIP-007', 'hipot', '高压继电器检查', 'High Voltage Relay Check', 'monthly', 30, 'technician', false, true, '检查高压继电器动作是否可靠', 'Check HV relay operation reliability', null, '继电器');

insert into wear_parts_reference (machine_type, part_name_zh, part_name_en, typical_lifetime_zh, typical_lifetime_en, replacement_frequency, is_safety_critical) values
('hipot', '高压线缆', 'High Voltage Cable', '约1年', '1 year', '每年', true),
('hipot', '高压继电器', 'High Voltage Relay', '约2年', '2 years', '每2年', false),
('hipot', '高压探头', 'High Voltage Probe', '约2年', '2 years', '每2年', false);

-- =====================================================================
-- 15. 点胶机 / DISPENSER
-- =====================================================================
insert into maint_task_library (task_code, machine_type, task_name_zh, task_name_en, frequency, estimated_minutes, skill_level, safety_required, is_critical_path, description_zh, description_en, tools_required, parts_may_need) values
('MNT-DIS-001', 'dispenser', '点胶针头清洁', 'Dispensing Needle Cleaning', 'shift', 15, 'operator', false, true, '清洁点胶针头，防止堵塞', 'Clean dispensing needle to prevent clogging', '针头清洁套件', null),
('MNT-DIS-002', 'dispenser', '胶水液位检查', 'Glue Level Check', 'shift', 10, 'operator', false, false, '检查胶水余量，及时补充', 'Check glue remaining, top up if low', null, '胶水'),
('MNT-DIS-003', 'dispenser', '气压检查', 'Air Pressure Check', 'shift', 10, 'operator', false, true, '检查气压是否正常', 'Check air pressure normal', '气压表', null),
('MNT-DIS-004', 'dispenser', '点胶精度首件检查', 'First Article Dispensing Accuracy Check', 'shift', 15, 'operator', false, true, '首件检查点胶位置和胶量是否在范围内', 'First article: check dispense position and volume', '放大镜', null),
('MNT-DIS-005', 'dispenser', '胶阀清洗', 'Glue Valve Cleaning', 'daily', 20, 'operator', false, false, '拆卸清洗胶阀内部', 'Disassemble and clean glue valve internals', '清洗剂', '密封圈'),
('MNT-DIS-006', 'dispenser', '胶阀密封圈更换', 'Glue Valve Seal Replacement', 'weekly', 30, 'technician', false, false, '更换老化的胶阀密封圈', 'Replace aged glue valve seals', '密封圈套装', '密封圈'),
('MNT-DIS-007', 'dispenser', 'XYZ轴润滑', 'XYZ Axis Lubrication', 'weekly', 20, 'technician', false, false, '润滑XYZ三轴导轨', 'Lubricate XYZ axis guide rails', '润滑脂', '润滑脂'),
('MNT-DIS-008', 'dispenser', '点胶量校准', 'Dispense Volume Calibration', 'monthly', 40, 'technician', false, true, '使用天平校准点胶量精度', 'Calibrate dispense volume using precision scale', '精密天平', null),
('MNT-DIS-009', 'dispenser', '胶泵检查', 'Glue Pump Check', 'quarterly', 40, 'technician', false, false, '检查胶泵运转状态和密封性', 'Check glue pump operation and sealing', null, '胶泵密封');

insert into wear_parts_reference (machine_type, part_name_zh, part_name_en, typical_lifetime_zh, typical_lifetime_en, replacement_frequency, is_safety_critical) values
('dispenser', '点胶针头', 'Dispensing Needle', '按需', 'As needed', '按堵塞频率', false),
('dispenser', '胶阀密封圈', 'Glue Valve Seal', '约1个月', '1 month', '每月', false),
('dispenser', '胶泵密封', 'Glue Pump Seal', '约3个月', '3 months', '每季度', false),
('dispenser', '导轨滑块', 'Guide Rail Block', '约2年', '2 years', '每2年', false);

-- =====================================================================
-- 16. ATE 自动测试设备
-- =====================================================================
insert into maint_task_library (task_code, machine_type, task_name_zh, task_name_en, frequency, estimated_minutes, skill_level, safety_required, is_critical_path, description_zh, description_en, tools_required, parts_may_need) values
('MNT-ATE-001', 'ATE', '测试接口检查', 'Test Interface Check', 'shift', 15, 'operator', false, false, '检查测试接口和连接线是否完好', 'Check test interface and cables', null, null),
('MNT-ATE-002', 'ATE', '电源自检', 'Power Self-Test', 'shift', 10, 'operator', false, true, '运行电源自检程序', 'Run power self-test', null, null),
('MNT-ATE-003', 'ATE', '系统软件更新检查', 'Software Update Check', 'daily', 10, 'operator', false, false, '检查系统软件是否有更新', 'Check for system software updates', null, null),
('MNT-ATE-004', 'ATE', '散热风扇检查', 'Heat Dissipation Fan Check', 'daily', 10, 'operator', false, false, '检查风扇运转情况', 'Check fan operation', null, '风扇'),
('MNT-ATE-005', 'ATE', '接线端子紧固', 'Terminal Screw Tightening', 'weekly', 20, 'technician', false, false, '检查并紧固所有接线端子', 'Check and tighten all terminal screws', '螺丝刀', '端子'),
('MNT-ATE-006', 'ATE', '仪表校准', 'Instrument Calibration', 'quarterly', 60, 'engineer', false, true, '对测试用仪表进行全面校准', 'Full calibration of test instruments', '标准信号源', null),
('MNT-ATE-007', 'ATE', '板卡除尘', 'Board Dust Cleaning', 'monthly', 30, 'technician', false, false, '对内部板卡进行除尘清洁', 'Dust clean internal boards', '除尘气罐', null);

insert into wear_parts_reference (machine_type, part_name_zh, part_name_en, typical_lifetime_zh, typical_lifetime_en, replacement_frequency, is_safety_critical) values
('ATE', '风扇', 'Fan', '约2年', '2 years', '每2年', false),
('ATE', '接线端子', 'Terminal Block', '约3年', '3 years', '按需', false),
('ATE', '测试线缆', 'Test Cable', '约6个月', '6 months', '每半年', false);

-- =====================================================================
-- 17. 返修工作站 / REWORK STATION
-- =====================================================================
insert into maint_task_library (task_code, machine_type, task_name_zh, task_name_en, frequency, estimated_minutes, skill_level, safety_required, is_critical_path, description_zh, description_en, tools_required, parts_may_need) values
('MNT-RW-001', 'rework_station', '温度设定检查', 'Temperature Setting Check', 'shift', 10, 'operator', false, true, '检查烙铁/热风枪温度设定', 'Check iron/hot air gun temperature setting', '测温仪', null),
('MNT-RW-002', 'rework_station', '烙铁头清洁', 'Soldering Iron Tip Cleaning', 'shift', 10, 'operator', false, true, '清洁烙铁头氧化层', 'Clean oxidation from soldering iron tip', '湿海绵, 烙铁清洁丝', null),
('MNT-RW-003', 'rework_station', '热风枪出风口检查', 'Hot Air Gun Nozzle Check', 'shift', 10, 'operator', false, false, '检查热风枪出风口有无堵塞', 'Check hot air gun nozzle for blockage', null, null),
('MNT-RW-004', 'rework_station', '烙铁头更换', 'Soldering Iron Tip Replacement', 'weekly', 15, 'operator', false, false, '更换氧化或烧蚀的烙铁头', 'Replace oxidized or worn iron tip', '烙铁头', '烙铁头'),
('MNT-RW-005', 'rework_station', '温度传感器校准', 'Temperature Sensor Calibration', 'monthly', 30, 'technician', false, true, '校准烙铁和热风枪温度传感器', 'Calibrate iron and hot air gun temp sensors', '测温仪', '温度传感器'),
('MNT-RW-006', 'rework_station', '接地电阻检查', 'Ground Resistance Check', 'monthly', 15, 'technician', true, true, '测量烙铁接地电阻，确保防静电', 'Measure iron ground resistance for ESD', '万用表', null),
('MNT-RW-007', 'rework_station', '热风枪发热芯更换', 'Hot Air Gun Heating Element Replacement', '半年度', 40, 'technician', false, false, '更换老化的热风枪发热芯', 'Replace aging hot air gun heating element', '发热芯', '发热芯');

insert into wear_parts_reference (machine_type, part_name_zh, part_name_en, typical_lifetime_zh, typical_lifetime_en, replacement_frequency, is_safety_critical) values
('rework_station', '烙铁头', 'Soldering Iron Tip', '约1-3个月', '1-3 months', '每月', false),
('rework_station', '热风枪发热芯', 'Hot Air Gun Heating Element', '约6个月', '6 months', '每半年', false),
('rework_station', '热风枪喷嘴', 'Hot Air Nozzle', '约1年', '1 year', '每年', false);

-- =====================================================================
-- 18. 热风枪 (standalone) / HOT AIR GUN
-- =====================================================================
insert into maint_task_library (task_code, machine_type, task_name_zh, task_name_en, frequency, estimated_minutes, skill_level, safety_required, is_critical_path, description_zh, description_en, tools_required, parts_may_need) values
('MNT-HA-001', 'hot_air_gun', '温度校准检查', 'Temperature Calibration Check', 'shift', 10, 'operator', false, true, '使用测温仪核对实际温度', 'Verify actual temp with thermometer', '测温仪', null),
('MNT-HA-002', 'hot_air_gun', '风口清洁', 'Nozzle Cleaning', 'daily', 10, 'operator', false, false, '清洁出风口杂物和残锡', 'Clean nozzle debris and solder residue', null, null),
('MNT-HA-003', 'hot_air_gun', '发热丝检查', 'Heating Coil Check', 'weekly', 15, 'technician', false, true, '检查发热丝是否正常，有无断裂', 'Check heating coil for continuity', '万用表', '发热丝'),
('MNT-HA-004', 'hot_air_gun', '风机检查', 'Fan Motor Check', 'monthly', 15, 'technician', false, true, '检查风机运转是否正常', 'Check fan motor operation', null, '风机'),
('MNT-HA-005', 'hot_air_gun', '发热芯更换', 'Heating Element Replacement', '半年度', 30, 'technician', false, false, '更换老化的发热芯', 'Replace aging heating element', '发热芯', '发热芯');

insert into wear_parts_reference (machine_type, part_name_zh, part_name_en, typical_lifetime_zh, typical_lifetime_en, replacement_frequency, is_safety_critical) values
('hot_air_gun', '发热芯', 'Heating Element', '约6个月', '6 months', '每半年', false),
('hot_air_gun', '风机', 'Fan Motor', '约1年', '1 year', '每年', false);

-- =====================================================================
-- 19. 烙铁 (standalone) / SOLDERING IRON
-- =====================================================================
insert into maint_task_library (task_code, machine_type, task_name_zh, task_name_en, frequency, estimated_minutes, skill_level, safety_required, is_critical_path, description_zh, description_en, tools_required, parts_may_need) values
('MNT-SI-001', 'soldering_iron', '温度检查', 'Temperature Check', 'shift', 5, 'operator', false, true, '使用测温仪测量烙铁头温度', 'Measure iron tip temp with thermometer', '测温仪', null),
('MNT-SI-002', 'soldering_iron', '烙铁头清洁', 'Tip Cleaning', 'shift', 5, 'operator', false, true, '及时清洁烙铁头氧化层', 'Clean tip oxidation promptly', '湿海绵', null),
('MNT-SI-003', 'soldering_iron', '接地电阻检查', 'Ground Resistance Check', 'weekly', 10, 'operator', true, true, '测量烙铁接地电阻≤1Ω（防静电）', 'Measure tip ground resistance ≤1Ω (ESD)', '万用表', null),
('MNT-SI-004', 'soldering_iron', '烙铁头更换', 'Tip Replacement', 'monthly', 10, 'operator', false, false, '更换氧化或烧蚀的烙铁头', 'Replace oxidized or worn tip', '烙铁头', '烙铁头'),
('MNT-SI-005', 'soldering_iron', '发热芯检查', 'Heating Element Check', 'monthly', 15, 'technician', false, false, '检测发热芯是否正常', 'Check heating element continuity', '万用表', '发热芯');

insert into wear_parts_reference (machine_type, part_name_zh, part_name_en, typical_lifetime_zh, typical_lifetime_en, replacement_frequency, is_safety_critical) values
('soldering_iron', '烙铁头', 'Soldering Tip', '约1-3个月', '1-3 months', '每月', false),
('soldering_iron', '发热芯', 'Heating Element', '约6个月', '6 months', '每半年', false);

-- =====================================================================
-- 20. 标签打印机 / LABEL PRINTER
-- =====================================================================
insert into maint_task_library (task_code, machine_type, task_name_zh, task_name_en, frequency, estimated_minutes, skill_level, safety_required, is_critical_path, description_zh, description_en, tools_required, parts_may_need) values
('MNT-LP-001', 'label_printer', '打印头清洁', 'Print Head Cleaning', 'shift', 10, 'operator', false, false, '清洁打印头残墨和污渍', 'Clean print head residual ink and dirt', '打印头清洁笔', null),
('MNT-LP-002', 'label_printer', '标签纸/碳带检查', 'Label & Ribbon Check', 'shift', 5, 'operator', false, false, '检查标签纸和碳带余量', 'Check label and ribbon remaining', null, '碳带'),
('MNT-LP-003', 'label_printer', '打印质量检查', 'Print Quality Check', 'shift', 10, 'operator', false, false, '打印测试页，检查字迹清晰度', 'Print test page, check print clarity', null, null),
('MNT-LP-004', 'label_printer', '传感器清洁', 'Sensor Cleaning', 'weekly', 15, 'operator', false, false, '清洁标签传感器和碳带传感器', 'Clean label sensor and ribbon sensor', '软刷', null),
('MNT-LP-005', 'label_printer', '胶辊清洁与检查', 'Platen Roller Cleaning & Check', 'weekly', 15, 'operator', false, false, '清洁胶辊，检查有无磨损缺口', 'Clean platen roller, check for wear marks', '无尘布', null),
('MNT-LP-006', 'label_printer', '打印头更换', 'Print Head Replacement', '每季度', 30, 'technician', false, false, '更换达到寿命的打印头', 'Replace print head at end of life', '打印头', '打印头'),
('MNT-LP-007', 'label_printer', '胶辊更换', 'Platen Roller Replacement', '每季度', 30, 'technician', false, false, '更换磨损的胶辊', 'Replace worn platen roller', '胶辊', '胶辊');

insert into wear_parts_reference (machine_type, part_name_zh, part_name_en, typical_lifetime_zh, typical_lifetime_en, replacement_frequency, is_safety_critical) values
('label_printer', '打印头', 'Print Head', '约50-100km打印长度', '50-100km print length', '按需', false),
('label_printer', '碳带', 'Ribbon', '按使用量', 'Varies', '按需', false),
('label_printer', '胶辊', 'Platen Roller', '约6个月', '6 months', '每半年', false);

-- =====================================================================
-- 21. 铭牌机 / NAMEPLATE
-- =====================================================================
insert into maint_task_library (task_code, machine_type, task_name_zh, task_name_en, frequency, estimated_minutes, skill_level, safety_required, is_critical_path, description_zh, description_en, tools_required, parts_may_need) values
('MNT-NM-001', 'nameplate', '打印头清洁', 'Print Head Cleaning', 'shift', 10, 'operator', false, false, '清洁打印头', 'Clean print head', '打印头清洁笔', null),
('MNT-NM-002', 'nameplate', '耗材检查', 'Consumables Check', 'shift', 5, 'operator', false, false, '检查色带和基材余量', 'Check ribbon and substrate supply', null, '色带'),
('MNT-NM-003', 'nameplate', '打印质量首件检查', 'First Article Print Quality Check', 'shift', 10, 'operator', false, false, '首件检查打印内容是否清晰完整', 'First article: check print content clear and complete', null, null),
('MNT-NM-004', 'nameplate', '传感器清洁', 'Sensor Cleaning', 'weekly', 10, 'operator', false, false, '清洁进料和定位传感器', 'Clean feed and positioning sensors', '软刷', null),
('MNT-NM-005', 'nameplate', '机械传动检查', 'Mechanical Drive Check', 'monthly', 20, 'technician', false, false, '检查传动皮带和齿轮磨损', 'Check drive belt and gear wear', null, '皮带'),
('MNT-NM-006', 'nameplate', '打印头更换', 'Print Head Replacement', '每季度', 30, 'technician', false, false, '更换老化打印头', 'Replace aging print head', '打印头', '打印头');

insert into wear_parts_reference (machine_type, part_name_zh, part_name_en, typical_lifetime_zh, typical_lifetime_en, replacement_frequency, is_safety_critical) values
('nameplate', '打印头', 'Print Head', '约50km打印长度', '50km print length', '按需', false),
('nameplate', '色带', 'Ribbon', '按使用量', 'Varies', '按需', false),
('nameplate', '传动皮带', 'Drive Belt', '约1年', '1 year', '每年', false);

-- =====================================================================
-- 22. 包装扫描 / PACK SCAN
-- =====================================================================
insert into maint_task_library (task_code, machine_type, task_name_zh, task_name_en, frequency, estimated_minutes, skill_level, safety_required, is_critical_path, description_zh, description_en, tools_required, parts_may_need) values
('MNT-PSC-001', 'pack_scan', '扫描头清洁', 'Scan Head Cleaning', 'shift', 5, 'operator', false, false, '清洁扫描头镜头', 'Clean scan head lens', '镜头纸', null),
('MNT-PSC-002', 'pack_scan', '扫描灵敏度检查', 'Scan Sensitivity Check', 'shift', 5, 'operator', false, false, '测试条码扫描是否灵敏', 'Test barcode scanning sensitivity', null, null),
('MNT-PSC-003', 'pack_scan', '传送机构检查', 'Conveyor Check', 'daily', 10, 'operator', false, false, '检查传送带有无跑偏', 'Check conveyor belt deviation', null, '传送皮带'),
('MNT-PSC-004', 'pack_scan', '光源检查', 'Light Source Check', 'daily', 5, 'operator', false, false, '检查扫描光源是否正常', 'Check scan light source normal', null, null),
('MNT-PSC-005', 'pack_scan', '传感器校准', 'Sensor Calibration', 'monthly', 30, 'technician', false, false, '校准扫描传感器灵敏度', 'Calibrate scan sensor sensitivity', '标准条码', null),
('MNT-PSC-006', 'pack_scan', '传送皮带更换', 'Conveyor Belt Replacement', '每季度', 30, 'technician', false, false, '更换老化传送皮带', 'Replace aging conveyor belt', '传送皮带', '传送皮带');

insert into wear_parts_reference (machine_type, part_name_zh, part_name_en, typical_lifetime_zh, typical_lifetime_en, replacement_frequency, is_safety_critical) values
('pack_scan', '扫描头', 'Scan Head', '约3年', '3 years', '按需', false),
('pack_scan', '传送皮带', 'Conveyor Belt', '每季度', 'Quarterly', '每季度', false),
('pack_scan', '光源灯泡', 'Light Source Bulb', '约1年', '1 year', '每年', false);

-- =====================================================================
-- 23. WS-AOI (Wave Solder AOI)
-- =====================================================================
insert into maint_task_library (task_code, machine_type, task_name_zh, task_name_en, frequency, estimated_minutes, skill_level, safety_required, is_critical_path, description_zh, description_en, tools_required, parts_may_need) values
('MNT-WSA-001', 'WS-AOI', '光学系统清洁', 'Optical System Cleaning', 'shift', 10, 'operator', false, true, '清洁光学镜头和反光碗', 'Clean optical lens and reflector', '镜头纸', null),
('MNT-WSA-002', 'WS-AOI', '光源检查', 'Light Source Check', 'shift', 5, 'operator', false, true, '检查光源亮度是否正常', 'Check light source brightness normal', null, '光源灯泡'),
('MNT-WSA-003', 'WS-AOI', '传送机构自检', 'Conveyor Self-Test', 'shift', 10, 'operator', false, false, '运行传送机构自检', 'Run conveyor self-test', null, null),
('MNT-WSA-004', 'WS-AOI', '校准板校验', 'Calibration Board Verification', 'daily', 20, 'technician', false, true, '用标准校准板验证检测精度', 'Verify detection accuracy with calibration board', '校准板', null),
('MNT-WSA-005', 'WS-AOI', 'XY平台检查', 'XY Platform Check', 'weekly', 20, 'technician', false, false, '检查XY平台运动顺畅性', 'Check XY platform smooth movement', null, null),
('MNT-WSA-006', 'WS-AOI', '光源灯泡更换', 'Light Source Bulb Replacement', '每季度', 30, 'technician', false, false, '更换老化光源灯泡', 'Replace aging light source bulbs', '灯泡', '光源灯泡');

insert into wear_parts_reference (machine_type, part_name_zh, part_name_en, typical_lifetime_zh, typical_lifetime_en, replacement_frequency, is_safety_critical) values
('WS-AOI', '光源灯泡', 'Light Source Bulb', '约1000小时', '1000 hours', '每季度', false),
('WS-AOI', '光学镜头', 'Optical Lens', '约2年', '2 years', '按需', false),
('WS-AOI', '传送皮带', 'Conveyor Belt', '约1年', '1 year', '每年', false);

-- =====================================================================
-- 24. PDA (手持终端)
-- =====================================================================
insert into maint_task_library (task_code, machine_type, task_name_zh, task_name_en, frequency, estimated_minutes, skill_level, safety_required, is_critical_path, description_zh, description_en, tools_required, parts_may_need) values
('MNT-PDA-001', 'PDA', '电池电量检查', 'Battery Check', 'shift', 5, 'operator', false, false, '检查电池电量，及时充电', 'Check battery level, charge promptly', null, null),
('MNT-PDA-002', 'PDA', '屏幕与外壳清洁', 'Screen & Housing Cleaning', 'daily', 5, 'operator', false, false, '清洁屏幕和外壳污渍', 'Clean screen and housing', '屏幕清洁布', null),
('MNT-PDA-003', 'PDA', '扫描头清洁', 'Scan Head Cleaning', 'daily', 5, 'operator', false, false, '清洁条码扫描头', 'Clean barcode scan head', '镜头纸', null),
('MNT-PDA-004', 'PDA', '功能测试', 'Function Test', 'weekly', 10, 'operator', false, false, '测试扫描、触屏、按键功能', 'Test scan, touch screen, keypad', null, null),
('MNT-PDA-005', 'PDA', '电池更换', 'Battery Replacement', '每季度', 15, 'operator', false, false, '更换老化电池（容量明显下降时）', 'Replace aging battery (when capacity drops)', '电池', '电池'),
('MNT-PDA-006', 'PDA', '系统软件更新', 'System Software Update', '按需', 20, 'technician', false, false, '更新PDA系统和应用程序', 'Update PDA system and apps', null, null);

insert into wear_parts_reference (machine_type, part_name_zh, part_name_en, typical_lifetime_zh, typical_lifetime_en, replacement_frequency, is_safety_critical) values
('PDA', '电池', 'Battery', '约1-2年', '1-2 years', '每1-2年', false),
('PDA', '触摸屏', 'Touch Screen', '约2年', '2 years', '按需', false),
('PDA', '扫描头', 'Scan Head', '约2年', '2 years', '按需', false);

-- =====================================================================
-- CONSTRAINTS for new tables
-- =====================================================================

alter table maint_task_library add constraint maint_task_freq_check
  check (frequency is not null);

alter table maint_task_library add constraint maint_task_skill_check
  check (skill_level in ('operator','technician','engineer'));

alter table wear_parts_reference add constraint wear_parts_freq_check
  check (replacement_frequency is not null);

commit;
