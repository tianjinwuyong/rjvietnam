-- Migration 005: Equipment Periodic Checking Lists
-- Full lifecycle: template → schedule → execute → verify → compliance tracking

BEGIN;

-- ── 1. Checklist Templates ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS equipment_checklist_templates (
  id                bigserial PRIMARY KEY,
  template_code     varchar(60) UNIQUE NOT NULL,
  template_name     varchar(200) NOT NULL,
  equipment_type    varchar(100) NOT NULL,
  frequency         varchar(20) NOT NULL DEFAULT 'daily',
  is_active         boolean NOT NULL DEFAULT true,
  version           integer NOT NULL DEFAULT 1,
  created_by        varchar(120),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS equipment_checklist_items (
  id                bigserial PRIMARY KEY,
  template_id       bigint NOT NULL REFERENCES equipment_checklist_templates(id) ON DELETE CASCADE,
  item_order        integer NOT NULL DEFAULT 0,
  check_point       varchar(300) NOT NULL,
  check_method      varchar(300),
  standard_value    varchar(200),
  result_type       varchar(20) NOT NULL DEFAULT 'pass_fail',
  unit              varchar(40),
  lower_limit       numeric,
  upper_limit       numeric,
  is_optional       boolean NOT NULL DEFAULT false,
  category          varchar(40) NOT NULL DEFAULT 'operation',
  failure_priority  varchar(20) NOT NULL DEFAULT 'medium'
);

-- ── 2. Checking Records ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS equipment_checking_records (
  id                bigserial PRIMARY KEY,
  record_no         varchar(60) UNIQUE NOT NULL,
  template_id       bigint NOT NULL REFERENCES equipment_checklist_templates(id),
  equipment_id      bigint,
  equipment_code    varchar(60),
  equipment_name_zh varchar(200),
  line_id           bigint,
  line_name         varchar(120),
  frequency         varchar(20),
  shift_type        varchar(20) NOT NULL DEFAULT 'day',
  check_date        date NOT NULL,
  check_time        timestamptz NOT NULL DEFAULT now(),
  inspector_name    varchar(120) NOT NULL,
  inspector_id      bigint,
  total_items       integer NOT NULL DEFAULT 0,
  passed_items      integer NOT NULL DEFAULT 0,
  failed_items      integer NOT NULL DEFAULT 0,
  skipped_items     integer NOT NULL DEFAULT 0,
  overall_result    varchar(20) NOT NULL DEFAULT 'pass',
  notes             text,
  verified_by       varchar(120),
  verified_at       timestamptz,
  work_order_ids    bigint[],
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS equipment_checking_record_details (
  id                bigserial PRIMARY KEY,
  record_id         bigint NOT NULL REFERENCES equipment_checking_records(id) ON DELETE CASCADE,
  item_id           bigint NOT NULL REFERENCES equipment_checklist_items(id),
  item_order        integer NOT NULL DEFAULT 0,
  check_point       varchar(300),
  result            varchar(20) NOT NULL DEFAULT 'pass',
  numeric_value     numeric,
  notes             text,
  photo_url         text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- ── 3. Schedule & Compliance ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS equipment_checklist_schedule (
  id                 bigserial PRIMARY KEY,
  equipment_id       bigint,
  template_id        bigint NOT NULL REFERENCES equipment_checklist_templates(id),
  frequency          varchar(20) NOT NULL,
  scheduled_date     date NOT NULL,
  shift_type         varchar(20) NOT NULL DEFAULT 'day',
  assigned_inspector varchar(120),
  status             varchar(20) NOT NULL DEFAULT 'pending',
  record_id          bigint REFERENCES equipment_checking_records(id),
  completed_at       timestamptz,
  overridden_by      varchar(120),
  override_reason    text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS equipment_checklist_compliance_log (
  id                bigserial PRIMARY KEY,
  event_type        varchar(40) NOT NULL,
  schedule_id       bigint REFERENCES equipment_checklist_schedule(id),
  record_id         bigint REFERENCES equipment_checking_records(id),
  equipment_id      bigint,
  template_id       bigint REFERENCES equipment_checklist_templates(id),
  inspector_name    varchar(120),
  shift_type        varchar(20),
  check_date        date,
  details           text,
  created_by        varchar(120) DEFAULT 'system',
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- ── 4. Indexes ──────────────────────────────────────────────────────────────

CREATE INDEX idx_cl_items_template ON equipment_checklist_items(template_id);
CREATE INDEX idx_cl_items_order ON equipment_checklist_items(template_id, item_order);
CREATE INDEX idx_cl_records_template ON equipment_checking_records(template_id);
CREATE INDEX idx_cl_records_equipment ON equipment_checking_records(equipment_id);
CREATE INDEX idx_cl_records_date ON equipment_checking_records(check_date);
CREATE INDEX idx_cl_records_inspector ON equipment_checking_records(inspector_name);
CREATE INDEX idx_cl_details_record ON equipment_checking_record_details(record_id);
CREATE INDEX idx_cl_schedule_date ON equipment_checklist_schedule(scheduled_date);
CREATE INDEX idx_cl_schedule_equipment ON equipment_checklist_schedule(equipment_id, scheduled_date);
CREATE INDEX idx_cl_schedule_status ON equipment_checklist_schedule(status);
CREATE INDEX idx_cl_compliance_date ON equipment_checklist_compliance_log(created_at);
CREATE INDEX idx_cl_compliance_type ON equipment_checklist_compliance_log(event_type);

-- ── 5. Seed Templates ───────────────────────────────────────────────────────

INSERT INTO equipment_checklist_templates (template_code, template_name, equipment_type, frequency, created_by) VALUES
('CHK-SMT-NXT-DAILY', 'Fuji NXT III 每日点检表', 'SMT-NXT', 'daily', 'system'),
('CHK-DEK-DAILY', 'DEK Horizon 每日点检表', 'PRINTER-DEK', 'daily', 'system'),
('CHK-REFLOW-DAILY', 'Rehm V8 每日点检表', 'REF-V8', 'daily', 'system'),
('CHK-AOI-DAILY', 'CTI A40 AOI 每日点检表', 'AOI-CTI', 'daily', 'system'),
('CHK-SMT-WEEKLY', 'SMT 每周点检表', 'SMT-NXT', 'weekly', 'system'),
('CHK-ALL-MONTHLY', '全厂设备月度点检表', 'ALL', 'monthly', 'system');

-- CHK-SMT-NXT-DAILY items (12)
INSERT INTO equipment_checklist_items (template_id, item_order, check_point, check_method, standard_value, result_type, category, failure_priority) VALUES
(1, 1, '气压表读数是否在0.5-0.7MPa', '目视检查气压表指针', '0.5-0.7 MPa', 'pass_fail', 'pressure', 'critical'),
(1, 2, '紧急停止按钮是否正常', '按下再复位测试', '按钮弹起正常', 'pass_fail', 'safety', 'critical'),
(1, 3, '吸嘴磨损检查', '用放大镜检查吸嘴尖端', '无磨损/变形', 'pass_fail', 'mechanical', 'high'),
(1, 4, '轨道宽度是否与PCB匹配', '放入PCB试运行', 'PCB进出顺畅', 'pass_fail', 'operation', 'high'),
(1, 5, '锡膏粘度是否在合格范围', '用粘度计测试', '800-1200 kcps', 'pass_fail', 'operation', 'high'),
(1, 6, '供料器台车锁紧状态', '手动检查锁扣', '锁紧到位', 'pass_fail', 'safety', 'high'),
(1, 7, '飞达供料是否正常', '观察供料动作', '供料无卡顿', 'pass_fail', 'mechanical', 'medium'),
(1, 8, '视觉相机清洁', '用无尘布擦拭镜头', '无污渍/清晰', 'pass_fail', 'operation', 'medium'),
(1, 9, '真空压力值', '读取设备真空表', '≥ -80 kPa', 'numeric', 'pressure', 'high'),
(1, 10, '排出 conveyor 无异物', '目视检查', '无残留锡渣/元件', 'pass_fail', 'cleanliness', 'medium'),
(1, 11, '报警灯/蜂鸣器功能', '触发测试', '声光正常', 'pass_fail', 'safety', 'medium'),
(1, 12, '设备运行有无异响', '听诊', '无异响', 'pass_fail', 'mechanical', 'medium');

-- CHK-DEK-DAILY items (10)
INSERT INTO equipment_checklist_items (template_id, item_order, check_point, check_method, standard_value, result_type, category, failure_priority) VALUES
(2, 1, '刮刀压力是否正常', '读取压力值', '80-120 N', 'numeric', 'pressure', 'high'),
(2, 2, '钢网张力是否达标', '张力计测试', '≥ 35 N/cm²', 'numeric', 'operation', 'high'),
(2, 3, '钢网有无破损', '目视检查', '无破损/变形', 'pass_fail', 'mechanical', 'critical'),
(2, 4, '锡膏厚度检测是否正常', 'SPI测试板验证', '±15% 范围内', 'pass_fail', 'operation', 'high'),
(2, 5, '擦拭纸余量', '目视检查', '≥ 1/3 卷', 'pass_fail', 'operation', 'medium'),
(2, 6, '紧急停止按钮', '按下再复位测试', '按钮弹起正常', 'pass_fail', 'safety', 'critical'),
(2, 7, '基板定位 pin 完好', '目视检查', '无弯曲/缺失', 'pass_fail', 'mechanical', 'medium'),
(2, 8, '刮刀片磨损情况', '目视检查刀刃', '无缺口/变形', 'pass_fail', 'mechanical', 'high'),
(2, 9, '清洗液液位', '目视检查液位窗', '≥ 1/2', 'pass_fail', 'operation', 'low'),
(2, 10, '轨道夹紧装置正常', '放入PCB测试', '夹紧牢固', 'pass_fail', 'operation', 'high');

-- CHK-REFLOW-DAILY items (8)
INSERT INTO equipment_checklist_items (template_id, item_order, check_point, check_method, standard_value, result_type, category, failure_priority) VALUES
(3, 1, '各温区温度曲线验证', '读取温度曲线', '±5°C 设定值', 'pass_fail', 'temperature', 'critical'),
(3, 2, 'N2 流量/浓度', '读取流量计', '≥ 800 ppm', 'numeric', 'operation', 'high'),
(3, 3, '传送带宽度设置', '测量导轨宽度', '匹配PCB宽度', 'pass_fail', 'operation', 'high'),
(3, 4, '排风系统运行正常', '检查排风机电流', '运行正常', 'pass_fail', 'operation', 'medium'),
(3, 5, '冷却区温度', '读取温度值', '≤ 40°C', 'numeric', 'temperature', 'medium'),
(3, 6, '紧急停止按钮', '按下再复位测试', '按钮弹起正常', 'pass_fail', 'safety', 'critical'),
(3, 7, '过滤网清洁状态', '目视检查', '无堵塞', 'pass_fail', 'cleanliness', 'medium'),
(3, 8, '链条/传送带润滑', '检查油位', '油位正常', 'pass_fail', 'lubrication', 'low');

-- CHK-AOI-DAILY items (6)
INSERT INTO equipment_checklist_items (template_id, item_order, check_point, check_method, standard_value, result_type, category, failure_priority) VALUES
(4, 1, '相机校准状态', '运行校准程序', '校准通过', 'pass_fail', 'operation', 'critical'),
(4, 2, '光源亮度', '读取亮度值', '≥ 80% 初始值', 'numeric', 'operation', 'high'),
(4, 3, '传送带运行正常', '放入PCB测试', '运行平稳', 'pass_fail', 'operation', 'high'),
(4, 4, '紧急停止按钮', '按下再复位测试', '按钮弹起正常', 'pass_fail', 'safety', 'critical'),
(4, 5, '主机/显示器连接正常', '检查连接线', '通信正常', 'pass_fail', 'electrical', 'medium'),
(4, 6, '散热风扇运行', '听诊/目视', '风扇转动正常', 'pass_fail', 'mechanical', 'medium');

-- CHK-SMT-WEEKLY items (8)
INSERT INTO equipment_checklist_items (template_id, item_order, check_point, check_method, standard_value, result_type, category, failure_priority) VALUES
(5, 1, '真空泵滤芯清洁/更换', '拆开检查', '无堵塞', 'pass_fail', 'cleanliness', 'high'),
(5, 2, '各润滑点加注润滑油', '按润滑图执行', '油量充足', 'pass_fail', 'lubrication', 'medium'),
(5, 3, '皮带张力检查', '张力计测量', '规定范围内', 'pass_fail', 'mechanical', 'high'),
(5, 4, '校准吸嘴中心', '运行校准程序', '偏差 ≤ 0.1mm', 'pass_fail', 'operation', 'critical'),
(5, 5, '飞达平台水平', '水平仪测量', '水平偏差 ≤ 0.5mm', 'pass_fail', 'operation', 'medium'),
(5, 6, '安全光栅功能', '遮挡测试', '停止信号正常', 'pass_fail', 'safety', 'critical'),
(5, 7, '散热系统/空调滤网', '打开检查', '无积尘', 'pass_fail', 'cleanliness', 'medium'),
(5, 8, '接地电阻测量', '万用表测量', '≤ 4Ω', 'numeric', 'electrical', 'critical');

-- CHK-ALL-MONTHLY items (15)
INSERT INTO equipment_checklist_items (template_id, item_order, check_point, check_method, standard_value, result_type, category, failure_priority) VALUES
(6, 1, '接地电阻全面检测', '接地电阻测试仪', '≤ 4Ω', 'numeric', 'electrical', 'critical'),
(6, 2, '紧急停止系统联动测试', '逐台按下急停，确认全线停止', '全线停止', 'pass_fail', 'safety', 'critical'),
(6, 3, '气源干燥器排水', '手动排水', '无积水', 'pass_fail', 'operation', 'medium'),
(6, 4, '电控柜清洁及端子紧固', '目视+螺丝刀紧固', '无松动/积尘', 'pass_fail', 'electrical', 'high'),
(6, 5, '排烟/排风管道检查', '目视', '无堵塞/破损', 'pass_fail', 'cleanliness', 'medium'),
(6, 6, '设备水平度检查', '水平仪', '≤ 1mm/m', 'pass_fail', 'operation', 'medium'),
(6, 7, '灭火器/消防设施检查', '目视+压力表', '压力正常/未过期', 'pass_fail', 'safety', 'critical'),
(6, 8, '冷却水循环系统', '检查水温/水压', '正常范围', 'pass_fail', 'operation', 'high'),
(6, 9, 'UPS 电池状态', '读取状态指示灯', '绿灯常亮', 'pass_fail', 'electrical', 'high'),
(6, 10, '安全标识/警示牌', '目视', '完好/清晰', 'pass_fail', 'safety', 'medium'),
(6, 11, '设备外观及防锈', '目视', '无锈蚀/变形', 'pass_fail', 'operation', 'low'),
(6, 12, '照明系统', '逐台检查', '照明正常', 'pass_fail', 'operation', 'low'),
(6, 13, 'ESD 接地系统', '万用表测量', '≤ 1Ω', 'numeric', 'electrical', 'critical'),
(6, 14, '软件版本一致性', '查看设备软件版本', '与记录一致', 'pass_fail', 'software', 'medium'),
(6, 15, '备件/工具柜整理', '目视检查', '摆放整齐/账物一致', 'pass_fail', 'other', 'low');

COMMIT;
