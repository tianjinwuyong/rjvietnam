-- Migration 004: Equipment Maintenance Work Orders
-- Full lifecycle: report → assign → process → fix/hang/handover → close

BEGIN;

CREATE TABLE IF NOT EXISTS maintenance_work_orders (
  id                bigserial PRIMARY KEY,
  wo_no             varchar(40) UNIQUE NOT NULL,

  -- Equipment
  equipment_id      bigint,
  equipment_code    varchar(60),
  equipment_name_zh varchar(200),
  line_id           bigint,
  line_name         varchar(120),

  -- Issue info
  issue_time        timestamptz NOT NULL DEFAULT now(),
  issue_person      varchar(120) NOT NULL,
  issue_phone       varchar(40),
  fault_description text NOT NULL,
  fault_category    varchar(40) DEFAULT 'other',
  priority          varchar(20) DEFAULT 'medium',

  -- Assignment
  assigned_technician varchar(120),
  assigned_at       timestamptz,

  -- Status workflow
  status            varchar(40) NOT NULL DEFAULT 'waiting_to_process',
  received_at       timestamptz,
  started_at        timestamptz,
  completed_at      timestamptz,
  real_cause        text,
  resolution_notes  text,
  hanging_reason    text,
  handover_to       varchar(120),
  handover_at       timestamptz,
  handover_note     text,

  -- Parts & downtime
  parts_used        jsonb DEFAULT '[]'::jsonb,
  downtime_minutes  integer DEFAULT 0,
  photo_urls        text[] DEFAULT '{}',

  -- Meta
  created_by        varchar(120),
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_mwo_status ON maintenance_work_orders(status);
CREATE INDEX IF NOT EXISTS idx_mwo_equipment ON maintenance_work_orders(equipment_id);
CREATE INDEX IF NOT EXISTS idx_mwo_priority ON maintenance_work_orders(priority);
CREATE INDEX IF NOT EXISTS idx_mwo_issue_time ON maintenance_work_orders(issue_time DESC);
CREATE INDEX IF NOT EXISTS idx_mwo_technician ON maintenance_work_orders(assigned_technician);

-- Seed demo data
INSERT INTO maintenance_work_orders (wo_no, equipment_id, equipment_code, equipment_name_zh, line_id, line_name, issue_time, issue_person, fault_description, fault_category, priority, status, assigned_technician, real_cause, resolution_notes, downtime_minutes)
VALUES
  ('WO-240628-0001', 1, 'SMT-NXT-01', 'Fuji NXT III #1', 1, 'SMT-1F', NOW() - INTERVAL '3 days', 'Pham Van Long', '贴片头Z轴异常抖动，0402元件偏移0.2mm', 'mechanical', 'critical', 'fixed', 'Nguyen Van A', '贴片头Z轴直线导轨磨损导致间隙', '更换Z轴导轨组件，重新校准贴片头', 240),
  ('WO-240628-0002', 1, 'SMT-NXT-01', 'Fuji NXT III #1', 1, 'SMT-1F', NOW() - INTERVAL '2 days', 'Tran Thi B', '8号feeder无法正常送料，进料不到位', 'mechanical', 'high', 'handover_to_other', 'Le Van C', NULL, 'feeder压盖弹簧断裂', 60),
  ('WO-240628-0003', 3, 'PRINTER-DEK-01', 'DEK Horizon #1', 1, 'SMT-1F', NOW() - INTERVAL '1 day', 'Pham Van Long', '印刷机刮刀压力不稳定，锡膏厚度CPK<1.33', 'mechanical', 'high', 'in_processing', 'Nguyen Van A', NULL, NULL, 0),
  ('WO-240628-0004', 5, 'REF-V8-01', 'Rehm V8 Reflow', 2, 'SMT-2F', NOW() - INTERVAL '12 hours', 'Hoang Van D', '回流焊温区5温度异常波动±15°C，可能加热丝损坏', 'electrical', 'critical', 'received', NULL, NULL, NULL, 0),
  ('WO-240628-0005', 6, 'PRINTER-DEK-02', 'DEK Horizon #2', 2, 'SMT-2F', NOW() - INTERVAL '6 hours', 'Le Thi E', 'MARK相机识别不到PCB定位点，误报率80%', 'sensor', 'medium', 'waiting_to_process', NULL, NULL, NULL, 0),
  ('WO-240628-0006', 4, 'AOI-CTI-01', 'CTI A40 AOI', 1, 'SMT-1F', NOW() - INTERVAL '4 hours', 'Pham Van Long', 'AOI误报率异常升高(从2%升至25%)，需重新调试检测算法', 'software', 'medium', 'waiting_to_process', NULL, NULL, NULL, 0),
  ('WO-240628-0007', 2, 'SMT-NXT-02', 'Fuji NXT III #2', 1, 'SMT-1F', NOW() - INTERVAL '2 hours', 'Tran Thi B', '真空泵异響，吸力从-85kPa降至-60kPa', 'mechanical', 'critical', 'waiting_to_process', NULL, NULL, NULL, 0)
ON CONFLICT (wo_no) DO NOTHING;

COMMIT;
