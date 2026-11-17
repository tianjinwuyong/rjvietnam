-- M5 replenishment provenance and governed material differences.
ALTER TABLE replenishments
  ADD COLUMN IF NOT EXISTS original_requisition_id bigint REFERENCES requisitions(id),
  ADD COLUMN IF NOT EXISTS reason_code varchar(50);

CREATE INDEX IF NOT EXISTS idx_replenishment_original_req
  ON replenishments(original_requisition_id,work_order_id,status);

INSERT INTO _migrations(filename,hash)
VALUES('153_wms_m5_replenishment_shortage.sql','m5-replenishment-shortage-v1')
ON CONFLICT(filename) DO NOTHING;
