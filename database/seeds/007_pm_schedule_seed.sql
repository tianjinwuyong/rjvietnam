-- PM Schedule Seed Data
-- Seeds pm_templates + pm_template_tasks for core SMT machines
-- Based on docs/18-equipment-management.md PM frequency table
-- Run after migration 044_pm_schedule_system.sql

begin;

-- ============================================================
-- HELPER: Insert template + tasks in one shot per machine+freq
-- ============================================================

do $$
declare
    v_tid bigint;
begin

-- ============================================================
-- 1. MOUNTER (贴片机)
-- ============================================================

-- Daily
insert into pm_templates (template_code, machine_type, frequency_code, template_name, est_duration_minutes, requires_shutdown, requires_engineer)
values ('PM-MOUNTER-D', 'mounter', 'daily', '贴片机每日保养', 20, false, false)
on conflict (template_code) do nothing returning id into v_tid;
if v_tid is not null then
    insert into pm_template_tasks (template_id, task_no, task_name, task_type, description, pass_criteria, is_critical) values
    (v_tid, 10, '吸嘴清洁检查', 'clean', '检查每个吸嘴表面，清除锡渣残留', '无锡渣、无变形、无堵塞', true),
    (v_tid, 20, '校准零点', 'calibrate', '执行设备零点校准', '零点偏移在允许范围内', true),
    (v_tid, 30, '检查气压源', 'check', '查看气压表数值', '0.5-0.7 MPa', true),
    (v_tid, 40, '检查真空度', 'check', '查看真空表数值', '符合设备要求', false);
end if;

-- Weekly
insert into pm_templates (template_code, machine_type, frequency_code, template_name, est_duration_minutes, requires_shutdown, requires_engineer)
values ('PM-MOUNTER-W', 'mounter', 'weekly', '贴片机每周保养', 45, true, false)
on conflict (template_code) do nothing returning id into v_tid;
if v_tid is not null then
    insert into pm_template_tasks (template_id, task_no, task_name, task_type, description, pass_criteria, is_critical) values
    (v_tid, 10, '清洁轨道', 'clean', '清洁传送轨道表面及滚轮', '无杂物、无锡渣', false),
    (v_tid, 20, '润滑丝杠', 'lubricate', '对X/Y/Z轴丝杠添加润滑脂', '润滑脂充足、无干摩擦', true),
    (v_tid, 30, '检查取料姿态', 'check', '观察取料位置和姿态', '吸取成功率≥99.5%', true);
end if;

-- Monthly
insert into pm_templates (template_code, machine_type, frequency_code, template_name, est_duration_minutes, requires_shutdown, requires_engineer)
values ('PM-MOUNTER-M', 'mounter', 'monthly', '贴片机每月保养', 90, true, true)
on conflict (template_code) do nothing returning id into v_tid;
if v_tid is not null then
    insert into pm_template_tasks (template_id, task_no, task_name, task_type, description, pass_criteria, is_critical) values
    (v_tid, 10, '校准视觉系统', 'calibrate', '执行视觉系统校准程序', '识别精度在规格内', true),
    (v_tid, 20, '检查皮带张力', 'check', '手动按压检查各皮带', '张力适中、无明显松弛', true),
    (v_tid, 30, '校验贴装精度', 'test', '运行CPK测试程序', '贴装精度≥99.5%', true);
end if;

-- Quarterly
insert into pm_templates (template_code, machine_type, frequency_code, template_name, est_duration_minutes, requires_shutdown, requires_engineer)
values ('PM-MOUNTER-Q', 'mounter', 'quarterly', '贴片机每季度保养', 240, true, true)
on conflict (template_code) do nothing returning id into v_tid;
if v_tid is not null then
    insert into pm_template_tasks (template_id, task_no, task_name, task_type, description, pass_criteria, is_critical) values
    (v_tid, 10, '更换磨损轴承', 'replace', '检查并更换磨损轴承', '所有轴承运转正常', true),
    (v_tid, 20, '全面精度测试', 'test', '执行全面精度测试（偏移/旋转/高度）', '所有指标在规格内', true),
    (v_tid, 30, '校验运动模组', 'calibrate', '检查并校准各运动轴', '运动模组无异常间隙', true);
end if;

-- Yearly
insert into pm_templates (template_code, machine_type, frequency_code, template_name, est_duration_minutes, requires_shutdown, requires_engineer)
values ('PM-MOUNTER-Y', 'mounter', 'yearly', '贴片机年度大保养', 480, true, true)
on conflict (template_code) do nothing returning id into v_tid;
if v_tid is not null then
    insert into pm_template_tasks (template_id, task_no, task_name, task_type, description, pass_criteria, is_critical) values
    (v_tid, 10, '全面检修', 'test', '设备全面拆检、清洁、润滑', '各部件状态良好', true),
    (v_tid, 20, '更换老化皮带和轴承', 'replace', '更换所有老化皮带和轴承', '新件安装到位、运行正常', true),
    (v_tid, 30, '系统标定', 'calibrate', '全面标定设备参数', '标定数据存档', true);
end if;

-- ============================================================
-- 2. PRINTER (锡膏印刷机)
-- ============================================================

-- Daily
insert into pm_templates (template_code, machine_type, frequency_code, template_name, est_duration_minutes, requires_shutdown, requires_engineer)
values ('PM-PRINTER-D', 'printer', 'daily', '印刷机每日保养', 15, false, false)
on conflict (template_code) do nothing returning id into v_tid;
if v_tid is not null then
    insert into pm_template_tasks (template_id, task_no, task_name, task_type, description, pass_criteria, is_critical) values
    (v_tid, 10, '钢网清洁', 'clean', '清洁钢网上下表面', '无残留锡膏、网孔通畅', true),
    (v_tid, 20, '校验刮刀压力', 'check', '检查刮刀压力设定值', '符合工艺要求', true),
    (v_tid, 30, '校验刮刀速度', 'check', '检查刮刀速度设定值', '符合工艺要求', false);
end if;

-- Weekly
insert into pm_templates (template_code, machine_type, frequency_code, template_name, est_duration_minutes, requires_shutdown, requires_engineer)
values ('PM-PRINTER-W', 'printer', 'weekly', '印刷机每周保养', 30, true, false)
on conflict (template_code) do nothing returning id into v_tid;
if v_tid is not null then
    insert into pm_template_tasks (template_id, task_no, task_name, task_type, description, pass_criteria, is_critical) values
    (v_tid, 10, '清洁丝杠和导轨', 'clean', '清洁各轴丝杠和导轨表面', '无积垢、无锡渣', true),
    (v_tid, 20, '检查PCB定位夹具磨损', 'check', '目视检查夹具定位面', '夹具无松动、无过度磨损', false);
end if;

-- Monthly
insert into pm_templates (template_code, machine_type, frequency_code, template_name, est_duration_minutes, requires_shutdown, requires_engineer)
values ('PM-PRINTER-M', 'printer', 'monthly', '印刷机每月保养', 60, true, true)
on conflict (template_code) do nothing returning id into v_tid;
if v_tid is not null then
    insert into pm_template_tasks (template_id, task_no, task_name, task_type, description, pass_criteria, is_critical) values
    (v_tid, 10, '校准印刷精度', 'calibrate', '使用标准PCB执行精度测试', '偏移≤0.1mm', true),
    (v_tid, 20, '检查锡膏厚度', 'check', '检查SPI反馈的锡膏厚度数据', '厚度在工艺规格内', true);
end if;

-- Quarterly
insert into pm_templates (template_code, machine_type, frequency_code, template_name, est_duration_minutes, requires_shutdown, requires_engineer)
values ('PM-PRINTER-Q', 'printer', 'quarterly', '印刷机每季度保养', 120, true, true)
on conflict (template_code) do nothing returning id into v_tid;
if v_tid is not null then
    insert into pm_template_tasks (template_id, task_no, task_name, task_type, description, pass_criteria, is_critical) values
    (v_tid, 10, '更换刮刀垫片', 'replace', '检查并更换刮刀垫片', '新垫片安装到位', true),
    (v_tid, 20, '清洁润滑导轨', 'lubricate', '全面清洁并润滑各导轨', '润滑良好', false),
    (v_tid, 30, '校验钢网张力', 'test', '使用张力计测量钢网', '符合钢网规格', true);
end if;

-- Yearly
insert into pm_templates (template_code, machine_type, frequency_code, template_name, est_duration_minutes, requires_shutdown, requires_engineer)
values ('PM-PRINTER-Y', 'printer', 'yearly', '印刷机年度大保养', 360, true, true)
on conflict (template_code) do nothing returning id into v_tid;
if v_tid is not null then
    insert into pm_template_tasks (template_id, task_no, task_name, task_type, description, pass_criteria, is_critical) values
    (v_tid, 10, '更换钢网密封', 'replace', '更换钢网框密封条', '密封良好', true),
    (v_tid, 20, '检查回流链路', 'check', '检查PCB输送链路', '传输顺畅无卡板', true);
end if;

-- ============================================================
-- 3. REFLOW (回流焊)
-- ============================================================

insert into pm_templates (template_code, machine_type, frequency_code, template_name, est_duration_minutes, requires_shutdown, requires_engineer)
values ('PM-REFLOW-D', 'reflow', 'daily', '回流焊每日保养', 15, false, false)
on conflict (template_code) do nothing returning id into v_tid;
if v_tid is not null then
    insert into pm_template_tasks (template_id, task_no, task_name, task_type, description, pass_criteria, is_critical) values
    (v_tid, 10, '记录炉温曲线', 'check', '查看并记录今日炉温曲线数据', '曲线在标准范围内', true),
    (v_tid, 20, '检查助焊剂残留', 'check', '目视检查炉腔内部', '无明显助焊剂堆积', false),
    (v_tid, 30, '清洁传送带', 'clean', '清洁传送带表面', '无杂物、无残留', false);
end if;

insert into pm_templates (template_code, machine_type, frequency_code, template_name, est_duration_minutes, requires_shutdown, requires_engineer)
values ('PM-REFLOW-W', 'reflow', 'weekly', '回流焊每周保养', 30, true, false)
on conflict (template_code) do nothing returning id into v_tid;
if v_tid is not null then
    insert into pm_template_tasks (template_id, task_no, task_name, task_type, description, pass_criteria, is_critical) values
    (v_tid, 10, '清洁传送带和导轨', 'clean', '深度清洁传送带及导轨', '无积垢', false),
    (v_tid, 20, '校准热电偶', 'calibrate', '校准各区热电偶温度', '实际与设定±3°C内', true);
end if;

insert into pm_templates (template_code, machine_type, frequency_code, template_name, est_duration_minutes, requires_shutdown, requires_engineer)
values ('PM-REFLOW-M', 'reflow', 'monthly', '回流焊每月保养', 60, true, true)
on conflict (template_code) do nothing returning id into v_tid;
if v_tid is not null then
    insert into pm_template_tasks (template_id, task_no, task_name, task_type, description, pass_criteria, is_critical) values
    (v_tid, 10, '炉温曲线测试', 'test', '执行完整炉温曲线测试', '升温速率、恒温时间、回流峰值在规格内', true),
    (v_tid, 20, '检查冷却区温度', 'check', '查看冷却区运行状态', '冷却正常', false);
end if;

insert into pm_templates (template_code, machine_type, frequency_code, template_name, est_duration_minutes, requires_shutdown, requires_engineer)
values ('PM-REFLOW-Q', 'reflow', 'quarterly', '回流焊每季度保养', 180, true, true)
on conflict (template_code) do nothing returning id into v_tid;
if v_tid is not null then
    insert into pm_template_tasks (template_id, task_no, task_name, task_type, description, pass_criteria, is_critical) values
    (v_tid, 10, '检查加热管升温速率', 'check', '测量各加热区升温速率', '符合设备规格', true),
    (v_tid, 20, '清洁冷却风扇', 'clean', '清洁冷却风扇及散热器', '运转正常、无异响', true),
    (v_tid, 30, '更换过滤器', 'replace', '更换助焊剂过滤器', '新滤芯安装到位', true);
end if;

insert into pm_templates (template_code, machine_type, frequency_code, template_name, est_duration_minutes, requires_shutdown, requires_engineer)
values ('PM-REFLOW-Y', 'reflow', 'yearly', '回流焊年度大保养', 480, true, true)
on conflict (template_code) do nothing returning id into v_tid;
if v_tid is not null then
    insert into pm_template_tasks (template_id, task_no, task_name, task_type, description, pass_criteria, is_critical) values
    (v_tid, 10, '更换发热管组件', 'replace', '更换老化发热管', '新件安装到位、升温正常', true),
    (v_tid, 20, '检查热电偶精度', 'calibrate', '对比标准温度计校准所有热电偶', '误差≤±3°C', true),
    (v_tid, 30, '全面清洁炉膛', 'clean', '拆机全面清洁炉膛内部', '清洁度合格', false);
end if;

-- ============================================================
-- 4. AOI
-- ============================================================

insert into pm_templates (template_code, machine_type, frequency_code, template_name, est_duration_minutes, requires_shutdown, requires_engineer)
values ('PM-AOI-D', 'AOI', 'daily', 'AOI每日保养', 10, false, false)
on conflict (template_code) do nothing returning id into v_tid;
if v_tid is not null then
    insert into pm_template_tasks (template_id, task_no, task_name, task_type, description, pass_criteria, is_critical) values
    (v_tid, 10, '校准光源亮度', 'calibrate', '执行光源亮度校准', '光源正常、无衰减', true),
    (v_tid, 20, '执行软硬件自检', 'test', '运行系统自检程序', '无报错、正常运行', true);
end if;

insert into pm_templates (template_code, machine_type, frequency_code, template_name, est_duration_minutes, requires_shutdown, requires_engineer)
values ('PM-AOI-W', 'AOI', 'weekly', 'AOI每周保养', 20, true, false)
on conflict (template_code) do nothing returning id into v_tid;
if v_tid is not null then
    insert into pm_template_tasks (template_id, task_no, task_name, task_type, description, pass_criteria, is_critical) values
    (v_tid, 10, '清洁镜头和反光碗', 'clean', '清洁光学镜头和反光碗表面', '无灰尘、无污渍', true),
    (v_tid, 20, '标定基准板', 'calibrate', '使用基准板执行标定', '偏差在允许范围内', true);
end if;

insert into pm_templates (template_code, machine_type, frequency_code, template_name, est_duration_minutes, requires_shutdown, requires_engineer)
values ('PM-AOI-M', 'AOI', 'monthly', 'AOI每月保养', 45, true, true)
on conflict (template_code) do nothing returning id into v_tid;
if v_tid is not null then
    insert into pm_template_tasks (template_id, task_no, task_name, task_type, description, pass_criteria, is_critical) values
    (v_tid, 10, '执行精度测试', 'test', '使用标准板执行精度测试', '漏检率<0.5%', true),
    (v_tid, 20, '验证检测阈值', 'check', '检查和验证各检测项目阈值', '阈值设定合理', true);
end if;

insert into pm_templates (template_code, machine_type, frequency_code, template_name, est_duration_minutes, requires_shutdown, requires_engineer)
values ('PM-AOI-Q', 'AOI', 'quarterly', 'AOI每季度保养', 120, true, true)
on conflict (template_code) do nothing returning id into v_tid;
if v_tid is not null then
    insert into pm_template_tasks (template_id, task_no, task_name, task_type, description, pass_criteria, is_critical) values
    (v_tid, 10, '更换光源', 'replace', '检查并更换衰减光源', '光源亮度合格', true),
    (v_tid, 20, '校准运动平台', 'calibrate', '校准XY运动平台精度', '平台精度在规格内', true),
    (v_tid, 30, '检查XY平台精度', 'check', '运行平台精度测试', '定位精度≤0.01mm', true);
end if;

insert into pm_templates (template_code, machine_type, frequency_code, template_name, est_duration_minutes, requires_shutdown, requires_engineer)
values ('PM-AOI-Y', 'AOI', 'yearly', 'AOI年度大保养', 360, true, true)
on conflict (template_code) do nothing returning id into v_tid;
if v_tid is not null then
    insert into pm_template_tasks (template_id, task_no, task_name, task_type, description, pass_criteria, is_critical) values
    (v_tid, 10, '全面标定', 'calibrate', '全面标定光学和运动系统', '标定数据存档', true),
    (v_tid, 20, '执行Golden板测试', 'test', '使用Golden板执行全功能测试', '所有项目合格', true);
end if;

-- ============================================================
-- 5. SPI
-- ============================================================

insert into pm_templates (template_code, machine_type, frequency_code, template_name, est_duration_minutes, requires_shutdown, requires_engineer)
values ('PM-SPI-D', 'SPI', 'daily', 'SPI每日保养', 10, false, false)
on conflict (template_code) do nothing returning id into v_tid;
if v_tid is not null then
    insert into pm_template_tasks (template_id, task_no, task_name, task_type, description, pass_criteria, is_critical) values
    (v_tid, 10, '清洁光学镜头', 'clean', '清洁光学镜头和投射光栅面', '无灰尘、无污渍', true);
end if;

insert into pm_templates (template_code, machine_type, frequency_code, template_name, est_duration_minutes, requires_shutdown, requires_engineer)
values ('PM-SPI-W', 'SPI', 'weekly', 'SPI每周保养', 20, true, false)
on conflict (template_code) do nothing returning id into v_tid;
if v_tid is not null then
    insert into pm_template_tasks (template_id, task_no, task_name, task_type, description, pass_criteria, is_critical) values
    (v_tid, 10, '校准基准板', 'calibrate', '使用基准板执行校准', '偏差在允许范围内', true),
    (v_tid, 20, '检查传送机构', 'check', '检查PCB传送机构', '传送平稳、无卡顿', false);
end if;

insert into pm_templates (template_code, machine_type, frequency_code, template_name, est_duration_minutes, requires_shutdown, requires_engineer)
values ('PM-SPI-M', 'SPI', 'monthly', 'SPI每月保养', 45, true, true)
on conflict (template_code) do nothing returning id into v_tid;
if v_tid is not null then
    insert into pm_template_tasks (template_id, task_no, task_name, task_type, description, pass_criteria, is_critical) values
    (v_tid, 10, '执行精度测试', 'test', '使用标准板执行精度测试', '测量重复性在规格内', true),
    (v_tid, 20, '校验测量重复性', 'test', '重复测量同一位置10次', 'CV<5%', true);
end if;

insert into pm_templates (template_code, machine_type, frequency_code, template_name, est_duration_minutes, requires_shutdown, requires_engineer)
values ('PM-SPI-Q', 'SPI', 'quarterly', 'SPI每季度保养', 120, true, true)
on conflict (template_code) do nothing returning id into v_tid;
if v_tid is not null then
    insert into pm_template_tasks (template_id, task_no, task_name, task_type, description, pass_criteria, is_critical) values
    (v_tid, 10, '更换光源灯泡', 'replace', '检查并更换衰减光源灯泡', '光源强度达标', true),
    (v_tid, 20, '清洁光路组件', 'clean', '清洁光路系统中的所有光学组件', '无灰尘遮挡', true);
end if;

insert into pm_templates (template_code, machine_type, frequency_code, template_name, est_duration_minutes, requires_shutdown, requires_engineer)
values ('PM-SPI-Y', 'SPI', 'yearly', 'SPI年度大保养', 360, true, true)
on conflict (template_code) do nothing returning id into v_tid;
if v_tid is not null then
    insert into pm_template_tasks (template_id, task_no, task_name, task_type, description, pass_criteria, is_critical) values
    (v_tid, 10, '全面校准', 'calibrate', '全面校准光学和运动系统', '校准数据存档', true),
    (v_tid, 20, '执行系统验证', 'test', '使用认证标准板验证系统', '所有项目通过', true);
end if;

-- ============================================================
-- 6. DEMO PM SCHEDULE ASSIGNMENTS (for L001 machines)
-- ============================================================

-- Assign monthly PM to NXT-01 (mounter)
insert into pm_schedule_assignments (asset_id, template_id, frequency_code, next_due_date, assigned_team)
select ea.id, pt.id, 'monthly', current_date + interval '7 days', 'maintenance'
from equipment_assets ea
cross join pm_templates pt
where ea.asset_code = 'EQ-0001'
  and pt.template_code = 'PM-MOUNTER-M'
on conflict (asset_id, template_id) do nothing;

-- Assign yearly PM to NXT-01
insert into pm_schedule_assignments (asset_id, template_id, frequency_code, next_due_date, assigned_team)
select ea.id, pt.id, 'yearly', current_date + interval '30 days', 'maintenance'
from equipment_assets ea
cross join pm_templates pt
where ea.asset_code = 'EQ-0001'
  and pt.template_code = 'PM-MOUNTER-Y'
on conflict (asset_id, template_id) do nothing;

-- Assign daily PM to NXT-01 (mounter)
insert into pm_schedule_assignments (asset_id, template_id, frequency_code, next_due_date, assigned_team)
select ea.id, pt.id, 'daily', current_date, 'production'
from equipment_assets ea
cross join pm_templates pt
where ea.asset_code = 'EQ-0001'
  and pt.template_code = 'PM-MOUNTER-D'
on conflict (asset_id, template_id) do nothing;

raise notice 'PM schedule seed completed: 5 machine types × 5 frequencies = 25 templates';
end $$;

commit;
