-- SMT 盘装料（Reel）台账（2026-10-20）
-- 一盘一码：发料时记录盘号与数量（支持整盘/拆盘），退料按盘号回写消耗，工单结案按实耗核销。

BEGIN;

CREATE TABLE IF NOT EXISTS picking_reel (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  picking_id       uuid NOT NULL,
  picking_item_id  uuid NOT NULL,
  work_order_id    uuid NOT NULL,
  material_id      uuid NOT NULL,
  reel_no          varchar(120) NOT NULL,
  batch_no         varchar(100),
  from_location_id uuid,
  issued_qty       numeric NOT NULL DEFAULT 0,
  returned_qty     numeric NOT NULL DEFAULT 0,
  consumed_qty     numeric NOT NULL DEFAULT 0,
  status           varchar(20) NOT NULL DEFAULT 'issued',
  issued_at        timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  issued_by        user_profile,
  returned_at      timestamptz(3),
  returned_by      user_profile,
  remark           text,
  _created_at      timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_at      timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_picking_reel ON picking_reel (picking_id, reel_no);
CREATE INDEX IF NOT EXISTS idx_reel_wo ON picking_reel (work_order_id);
CREATE INDEX IF NOT EXISTS idx_reel_no ON picking_reel (reel_no);
CREATE INDEX IF NOT EXISTS idx_reel_material ON picking_reel (material_id);

-- 退料单记录盘号（找不到原盘时由系统生成新标签号写入）
ALTER TABLE production_return ADD COLUMN IF NOT EXISTS reel_no varchar(120);

-- 工单超耗（超补）审批：超过 BOM 标准用量 3‰ 需审批
ALTER TABLE work_order ADD COLUMN IF NOT EXISTS over_consume_status varchar(20);
ALTER TABLE work_order ADD COLUMN IF NOT EXISTS over_consume_rate numeric;
ALTER TABLE work_order ADD COLUMN IF NOT EXISTS over_consume_qty numeric;
ALTER TABLE work_order ADD COLUMN IF NOT EXISTS over_consume_approved_by user_profile;
ALTER TABLE work_order ADD COLUMN IF NOT EXISTS over_consume_approved_time timestamptz(3);
ALTER TABLE work_order ADD COLUMN IF NOT EXISTS over_consume_remark text;

COMMIT;
