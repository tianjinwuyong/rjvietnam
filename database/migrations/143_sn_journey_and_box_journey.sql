-- Migration: 143_sn_journey_and_box_journey
-- SN完整行程记录 + 包装箱物流追踪

-- SN行程事件表：记录每个SN的完整生命周期
CREATE TABLE IF NOT EXISTS sn_journey_events (
  journey_id BIGSERIAL PRIMARY KEY,
  sn VARCHAR(160) NOT NULL,
  batch_id VARCHAR(160),
  work_order_code VARCHAR(160),
  event_type VARCHAR(64) NOT NULL, -- LINE_ENTRY|STATION_ENTER|STATION_EXIT|NG_DEFECT|NG_PICKED|NG_REPAIRED|NG_REVIVED|NG_SCRAPPED|NG_SAMPLE|PACKAGING|PALLETIZING|OUTBOUND
  event_stage VARCHAR(32) NOT NULL, -- LINE|STATION|REPAIR|PACK|OUTBOUND
  station_code VARCHAR(64),
  station_name VARCHAR(160),
  result VARCHAR(32), -- PASS|FAIL|NG|REPAIRED|SCRAPPED|SAMPLE
  defect_code VARCHAR(64),
  defect_description TEXT,
  operator VARCHAR(120),
  actor VARCHAR(120), -- actual actor if different from operator
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  event_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sn_journey_sn_time ON sn_journey_events(sn, event_at DESC);
CREATE INDEX IF NOT EXISTS idx_sn_journey_batch ON sn_journey_events(batch_id, event_at DESC);
CREATE INDEX IF NOT EXISTS idx_sn_journey_type_time ON sn_journey_events(event_type, event_at DESC);
CREATE INDEX IF NOT EXISTS idx_sn_journey_work_order ON sn_journey_events(work_order_code, event_at DESC);

-- 包装箱物流行程表
CREATE TABLE IF NOT EXISTS box_journey_records (
  journey_id BIGSERIAL PRIMARY KEY,
  container_id VARCHAR(160) NOT NULL, -- 箱号
  work_order_code VARCHAR(160),
  pallet_code VARCHAR(160), -- 栈板号
  event_type VARCHAR(64) NOT NULL, -- ONLINE|PALLETIZING|WAREHOUSE_IN|STORAGE|MOVE|TRANSFER|EXPORT|IN_TRANSIT|SOLD|RETURN_REQUEST|RETURN_INBOUND|RETURN_REPAIR|DESTROY
  event_stage VARCHAR(32) NOT NULL, -- PRODUCTION|WAREHOUSE|DISTRIBUTION|RETURN|DESTRUCTION
  location_code VARCHAR(120), -- 当前/目标位置
  location_name VARCHAR(240), -- 位置名称
  next_location_code VARCHAR(120), -- 下一目的地（用于在途）
  next_location_name VARCHAR(240),
  operator VARCHAR(120),
  actor VARCHAR(120),
  detail JSONB NOT NULL DEFAULT '{}'::jsonb, -- 扩展信息（客户、订单号等）
  event_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_box_journey_container_time ON box_journey_records(container_id, event_at DESC);
CREATE INDEX IF NOT EXISTS idx_box_journey_pallet ON box_journey_records(pallet_code, event_at DESC);
CREATE INDEX IF NOT EXISTS idx_box_journey_type_time ON box_journey_records(event_type, event_at DESC);
CREATE INDEX IF NOT EXISTS idx_box_journey_location ON box_journey_records(location_code, event_at DESC);
CREATE INDEX IF NOT EXISTS idx_box_journey_work_order ON box_journey_records(work_order_code, event_at DESC);

-- 添加SN旅程视图（方便查询）
CREATE OR REPLACE VIEW sn_journey_view AS
SELECT 
  j.journey_id, j.sn, j.batch_id, j.work_order_code,
  j.event_type, j.event_stage, j.station_code, j.station_name,
  j.result, j.defect_code, j.defect_description,
  j.operator, j.actor, j.detail, j.event_at,
  -- 行程状态
  CASE 
    WHEN j.event_type = 'OUTBOUND' THEN 'COMPLETED'
    WHEN j.event_type = 'NG_SCRAPPED' THEN 'SCRAPPED'
    WHEN j.event_type = 'NG_SAMPLE' THEN 'SAMPLED'
    WHEN j.event_type = 'NG_REPAIRED' AND EXISTS (
      SELECT 1 FROM sn_journey_events WHERE sn = j.sn AND event_type = 'PACKAGING'
    ) THEN 'PACKAGED'
    WHEN j.event_type = 'NG_REPAIRED' THEN 'REPAIRED'
    WHEN j.event_type = 'NG_DEFECT' THEN 'UNDER_REPAIR'
    ELSE 'IN_PRODUCTION'
  END AS journey_status,
  -- 行程阶段
  CASE
    WHEN j.event_type IN ('OUTBOUND') THEN 'OUTBOUND'
    WHEN j.event_type IN ('PACKAGING', 'PALLETIZING') THEN 'PACKAGING'
    WHEN j.event_type IN ('NG_REPAIRED', 'NG_REVIVED', 'NG_PICKED') THEN 'REPAIR'
    WHEN j.event_type IN ('NG_DEFECT') THEN 'NG'
    WHEN j.event_type IN ('STATION_ENTER', 'STATION_EXIT', 'LINE_ENTRY') THEN 'LINE'
    ELSE 'OTHER'
  END AS current_stage
FROM sn_journey_events j;

-- 添加箱行程视图
CREATE OR REPLACE VIEW box_journey_view AS
SELECT
  b.journey_id, b.container_id, b.work_order_code, b.pallet_code,
  b.event_type, b.event_stage, b.location_code, b.location_name,
  b.next_location_code, b.next_location_name,
  b.operator, b.actor, b.detail, b.event_at,
  -- 当前状态
  CASE
    WHEN b.event_type = 'DESTROY' THEN 'DESTROYED'
    WHEN b.event_type = 'RETURN_REPAIR' THEN 'UNDER_REPAIR'
    WHEN b.event_type = 'RETURN_INBOUND' THEN 'RETURNED'
    WHEN b.event_type = 'SOLD' THEN 'SOLD'
    WHEN b.event_type = 'IN_TRANSIT' THEN 'IN_TRANSIT'
    WHEN b.event_type = 'EXPORT' THEN 'EXPORTED'
    WHEN b.event_type = 'WAREHOUSE_IN' THEN 'IN_WAREHOUSE'
    WHEN b.event_type = 'ONLINE' THEN 'IN_PRODUCTION'
    ELSE 'UNKNOWN'
  END AS logistics_status
FROM box_journey_records b;
