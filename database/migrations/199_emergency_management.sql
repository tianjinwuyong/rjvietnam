-- Migration 199: Emergency Management System
-- Grill Q11-Q14: d/d/d/d — 全覆盖应变平台

BEGIN;

-- Emergency events
CREATE TABLE IF NOT EXISTS emergency_events (
  id bigserial PRIMARY KEY,
  event_no varchar(30) NOT NULL UNIQUE,
    -- EM-YYYYMMDD-XXXX
  title varchar(200) NOT NULL,
  description text,
  event_type varchar(30) NOT NULL,
    -- equipment | quality | safety | supply | personnel | natural_disaster | other
  severity varchar(10) NOT NULL DEFAULT 'L2',
    -- L1(可继续)/L2(停线30min内)/L3(停线>30min或安全)
  status varchar(20) NOT NULL DEFAULT 'reported',
    -- reported | acknowledged | in_progress | resolved | closed | escalated
  reporter_id varchar(40),
  reporter_name varchar(80),
  reporter_role varchar(30),
  affected_equipment_id varchar(40),
  affected_equipment_code varchar(40),
  affected_line_id varchar(40),
  affected_line_code varchar(40),
  production_loss_hours numeric(8,2) DEFAULT 0,
  estimated_loss_amount numeric(12,2) DEFAULT 0,
  actual_loss_amount numeric(12,2),
  root_cause text,
  corrective_action text,
  preventive_action text,
  reported_at timestamptz DEFAULT now(),
  acknowledged_at timestamptz,
  acknowledged_by varchar(40),
  resolved_at timestamptz,
  resolved_by varchar(40),
  closed_at timestamptz,
  closed_by varchar(40),
  related_wo_id bigint,
  related_wo_no varchar(30),
  escalation_level int DEFAULT 0,
  last_notification_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_emergency_status ON emergency_events(status);
CREATE INDEX IF NOT EXISTS idx_emergency_severity ON emergency_events(severity);
CREATE INDEX IF NOT EXISTS idx_emergency_type ON emergency_events(event_type);
CREATE INDEX IF NOT EXISTS idx_emergency_reported ON emergency_events(reported_at DESC);

-- Emergency notifications log
CREATE TABLE IF NOT EXISTS emergency_notifications (
  id bigserial PRIMARY KEY,
  event_id bigint NOT NULL,
  channel varchar(20) NOT NULL,
    -- in_app | zalo | sms | phone | email | wechat
  recipient_role varchar(30) NOT NULL,
  recipient_id varchar(40),
  recipient_name varchar(80),
  message text NOT NULL,
  sent_at timestamptz DEFAULT now(),
  acknowledged_at timestamptz,
  response_time_seconds int,
  escalation_level int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_em_notify_event ON emergency_notifications(event_id);
CREATE INDEX IF NOT EXISTS idx_em_notify_ack ON emergency_notifications(acknowledged_at) WHERE acknowledged_at IS NULL;

-- Emergency SOP library
CREATE TABLE IF NOT EXISTS emergency_sop_library (
  id bigserial PRIMARY KEY,
  sop_code varchar(30) NOT NULL UNIQUE,
  title varchar(200) NOT NULL,
  event_type varchar(30) NOT NULL,
  applicable_equipment_category varchar(40),
  severity_level varchar(10),
  steps jsonb NOT NULL DEFAULT '[]',
    -- [{seq:1, step:'关闭电源', responsible:'工程师', timeout_min:5}, ...]
  check_items jsonb DEFAULT '[]',
  required_documents jsonb DEFAULT '[]',
  contact_escalation jsonb DEFAULT '[]',
  version int DEFAULT 1,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Seed default SOPs
INSERT INTO emergency_sop_library (sop_code, title, event_type, severity_level, steps, check_items)
VALUES
  ('SOP-EM-001', '贴片机突发故障应急', 'equipment', 'L2',
   '[{"seq":1,"step":"确认设备急停","responsible":"操作员","timeout_min":1},{"seq":2,"step":"通知线长和技术员","responsible":"操作员","timeout_min":2},{"seq":3,"step":"检查气源/电源/吸嘴状态","responsible":"技术员","timeout_min":10},{"seq":4,"step":"查阅SOP或联系供应商支持","responsible":"工程师","timeout_min":30},{"seq":5,"step":"维修后首件验证","responsible":"技术员+QC","timeout_min":15}]',
   '["气源压力正常","吸嘴无堵塞","贴装精度OK"]'),
  ('SOP-EM-002', '回流焊温区异常应急', 'equipment', 'L3',
   '[{"seq":1,"step":"立即停线并关闭回流焊","responsible":"操作员","timeout_min":1},{"seq":2,"step":"通知工程师和厂长","responsible":"线长","timeout_min":2},{"seq":3,"step":"检查加热管/热电偶/固态继电器","responsible":"工程师","timeout_min":20},{"seq":4,"step":"温度校准验证","responsible":"工程师","timeout_min":30},{"seq":5,"step":"试跑5pcs首件确认","responsible":"工程师+QC","timeout_min":20}]',
   '["温度曲线达标","焊点外观OK","无虚焊"]'),
  ('SOP-EM-003', '质量事故(批量不良)应急', 'quality', 'L3',
   '[{"seq":1,"step":"立即停止该工单生产","responsible":"线长","timeout_min":1},{"seq":2,"step":"隔离已生产批次(贴红标)","responsible":"QC","timeout_min":5},{"seq":3,"step":"通知QC主管和工程","responsible":"线长","timeout_min":3},{"seq":4,"step":"分析不良原因(人机料法环)","responsible":"工程师","timeout_min":30},{"seq":5,"step":"决定：返工/报废/客户确认","responsible":"工程经理","timeout_min":15}]',
   '["不良类型确认","根本原因明确","处置方案确定"]'),
  ('SOP-EM-004', '自然灾害(台风/洪水)应急', 'natural_disaster', 'L3',
   '[{"seq":1,"step":"接收预警通知","responsible":"厂长","timeout_min":0},{"seq":2,"step":"评估是否提前停产","responsible":"厂长","timeout_min":30},{"seq":3,"step":"设备断电+防护","responsible":"工程师","timeout_min":60},{"seq":4,"step":"物料/成品转移到安全区域","responsible":"仓管","timeout_min":120},{"seq":5,"step":"人员安全撤离","responsible":"HR","timeout_min":30}]',
   '["设备已防护","物料已转移","人员已撤离","损失评估完成"]'),
  ('SOP-EM-005', '安全生产事故应急', 'safety', 'L3',
   '[{"seq":1,"step":"立即救护伤员","responsible":"现场人员","timeout_min":1},{"seq":2,"step":"保护现场/断电/通风","responsible":"工程师","timeout_min":2},{"seq":3,"step":"通知安全主管+厂长+急救车","responsible":"线长","timeout_min":3},{"seq":4,"step":"启动急救/送医","responsible":"HR","timeout_min":10},{"seq":5,"step":"事故调查+整改","responsible":"安全主管","timeout_min":120}]',
   '["伤员已送医","现场已保护","调查报告完成","整改措施落实"]')
ON CONFLICT (sop_code) DO NOTHING;

-- Emergency drill records
CREATE TABLE IF NOT EXISTS emergency_drills (
  id bigserial PRIMARY KEY,
  drill_code varchar(30) NOT NULL UNIQUE,
  title varchar(200) NOT NULL,
  event_type varchar(30) NOT NULL,
  scheduled_date date NOT NULL,
  actual_date date,
  participants int DEFAULT 0,
  duration_minutes int,
  result varchar(20),
    -- pass | fail | partial | cancelled
  findings text,
  improvements jsonb DEFAULT '[]',
  conducted_by varchar(80),
  created_at timestamptz DEFAULT now()
);

-- Escalation rules
CREATE TABLE IF NOT EXISTS emergency_escalation_rules (
  id bigserial PRIMARY KEY,
  event_type varchar(30) NOT NULL,
  severity_level varchar(10) NOT NULL,
  escalation_step int NOT NULL,
  time_threshold_minutes int NOT NULL,
  notify_role varchar(30) NOT NULL,
  notify_channel varchar(20) DEFAULT 'zalo',
  message_template text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Seed escalation rules
INSERT INTO emergency_escalation_rules (event_type, severity_level, escalation_step, time_threshold_minutes, notify_role, notify_channel, message_template)
VALUES
  ('equipment', 'L1', 1, 30, 'technician', 'in_app', 'L1事件: {title}，请确认处理'),
  ('equipment', 'L2', 1, 15, 'technician', 'zalo', '🚨设备停线: {title}，请立即响应'),
  ('equipment', 'L2', 2, 30, 'engineering_manager', 'zalo', '⚠️设备停线超过30min: {title}，请介入'),
  ('equipment', 'L3', 1, 5, 'engineering_manager', 'zalo', '🔴严重停线: {title}，请立即处理'),
  ('equipment', 'L3', 2, 15, 'factory_director', 'zalo', '🚨紧急: {title}，需您立即决策'),
  ('quality', 'L3', 1, 10, 'qc_supervisor', 'in_app', '🔴质量事故: {title}，请立即介入'),
  ('quality', 'L3', 2, 30, 'engineering_manager', 'zalo', '⚠️质量事故升级: {title}'),
  ('safety', 'L3', 1, 2, 'safety_officer', 'zalo', '🆘安全事故: {title}，立即响应'),
  ('safety', 'L3', 2, 5, 'factory_director', 'zalo', '🆘安全事故: {title}，需您立即决策'),
  ('safety', 'L3', 3, 10, 'general_manager', 'phone', '🆘安全事故: {title}，请知会'),
  ('natural_disaster', 'L3', 1, 60, 'factory_director', 'zalo', '🌀自然灾害预警: {title}'),
  ('supply', 'L2', 1, 30, 'engineering_manager', 'in_app', '⚠️物料断供: {title}，请评估影响')
ON CONFLICT DO NOTHING;

COMMIT;
