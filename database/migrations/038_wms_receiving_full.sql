-- ============================================================
-- 038: WMS 完整收料管理
--   material_lots 新增收料人/收料时间/PO号/照片/库位
--   ancillary_materials 辅助包装物（托盘/料架等）
--   receiving_issues 收料问题记录（缺料/损坏/其他）
-- ============================================================

-- 1. material_lots 扩展字段
ALTER TABLE material_lots
  ADD COLUMN IF NOT EXISTS po_no              VARCHAR(80),
  ADD COLUMN IF NOT EXISTS received_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS receiver_id       BIGINT REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS received_location_id BIGINT REFERENCES storage_locations(id),
  ADD COLUMN IF NOT EXISTS receiving_photo_url VARCHAR(500),
  ADD COLUMN IF NOT EXISTS receiving_notes    VARCHAR(1000);

-- 2. ancillary_materials 辅助包装物/托盘押金
CREATE TABLE IF NOT EXISTS ancillary_materials (
  id                    BIGSERIAL PRIMARY KEY,
  material_lot_id       BIGINT NOT NULL REFERENCES material_lots(id) ON DELETE CASCADE,
  item_type             VARCHAR(30) NOT NULL,
  item_desc             VARCHAR(160),
  qty                   NUMERIC(18,4) NOT NULL DEFAULT 1 CHECK (qty > 0),
  deposit_required      BOOLEAN NOT NULL DEFAULT FALSE,
  deposit_amount        NUMERIC(12,2) DEFAULT 0,
  deposit_currency      VARCHAR(3) DEFAULT 'VND',
  returned              BOOLEAN NOT NULL DEFAULT FALSE,
  returned_at           TIMESTAMPTZ,
  return_note           VARCHAR(240),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. receiving_issues 收料问题
CREATE TABLE IF NOT EXISTS receiving_issues (
  id                    BIGSERIAL PRIMARY KEY,
  material_lot_id       BIGINT NOT NULL REFERENCES material_lots(id) ON DELETE CASCADE,
  issue_type            VARCHAR(20) NOT NULL,
  issue_desc            VARCHAR(500),
  reported_by_id        BIGINT REFERENCES users(id),
  reported_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved              BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_by_id        BIGINT REFERENCES users(id),
  resolved_at           TIMESTAMPTZ,
  resolution_note       VARCHAR(500),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. view for receiving queue
CREATE OR REPLACE VIEW v_receiving_queue AS
SELECT
  ml.id,
  ml.lot_no,
  ml.po_no,
  ml.received_qty,
  ml.received_at,
  ml.receiving_photo_url,
  ml.receiving_notes,
  ml.iqc_status,
  m.code    AS material_code,
  m.name_zh AS material_name_zh,
  s.code    AS supplier_code,
  s.name_zh AS supplier_name_zh,
  sl.code   AS location_code,
  u.display_name AS receiver_name,
  CASE WHEN EXISTS (SELECT 1 FROM receiving_issues ri WHERE ri.material_lot_id = ml.id AND NOT ri.resolved)
       THEN TRUE ELSE FALSE END AS has_open_issues
FROM material_lots ml
JOIN materials m ON m.id = ml.material_id
JOIN suppliers s ON s.id = ml.supplier_id
LEFT JOIN storage_locations sl ON sl.id = ml.received_location_id
LEFT JOIN users u ON u.id = ml.receiver_id
ORDER BY ml.received_at DESC NULLS LAST;

-- 5. fn_receive_material
CREATE OR REPLACE FUNCTION fn_receive_material(
  p_lot_no            VARCHAR,
  p_material_id       BIGINT,
  p_supplier_id      BIGINT,
  p_received_qty      NUMERIC,
  p_po_no             VARCHAR,
  p_receiver_id       BIGINT,
  p_location_id       BIGINT,
  p_received_at       TIMESTAMPTZ,
  p_receiving_notes  VARCHAR,
  p_ancillary_items  JSONB,
  p_iqc_required     BOOLEAN
)
RETURNS BIGINT AS $$
DECLARE
  v_lot_id BIGINT;
  v_iqc_status VARCHAR(20);
  v_tx_no VARCHAR(40);
BEGIN
  v_iqc_status := CASE WHEN p_iqc_required = FALSE THEN 'released' ELSE 'pending' END;
  v_tx_no := 'RX_' || to_char(NOW(), 'YYYYMMDDHH24MISS') || '_' || floor(random()*10000)::INT;

  INSERT INTO material_lots (
    material_id, supplier_id, lot_no, po_no, received_qty,
    received_at, receiver_id, received_location_id,
    receiving_notes, iqc_status, created_at
  ) VALUES (
    p_material_id, p_supplier_id, p_lot_no, p_po_no, p_received_qty,
    p_received_at, p_receiver_id, p_location_id,
    p_receiving_notes, v_iqc_status, now()
  ) RETURNING id INTO v_lot_id;

  INSERT INTO inventory_transactions (
    tx_no, action, material_lot_id, qty, to_location_id,
    operator_id, tx_status, occurred_at
  ) VALUES (
    v_tx_no, 'RECEIVE', v_lot_id, p_received_qty, p_location_id,
    p_receiver_id, 'completed', p_received_at
  );

  IF p_ancillary_items IS NOT NULL AND jsonb_array_length(p_ancillary_items) > 0 THEN
    INSERT INTO ancillary_materials (material_lot_id, item_type, item_desc, qty, deposit_required, deposit_amount, deposit_currency)
    SELECT v_lot_id, (j->>'item_type'), (j->>'item_desc'),
           (j->>'qty')::NUMERIC, (j->>'deposit_required')::BOOLEAN,
           COALESCE((j->>'deposit_amount')::NUMERIC, 0),
           COALESCE(j->>'deposit_currency', 'VND')
    FROM jsonb_array_elements(p_ancillary_items) AS j;
  END IF;

  RETURN v_lot_id;
END;
$$ LANGUAGE plpgsql;

-- 6. fn_receive_issue
CREATE OR REPLACE FUNCTION fn_receive_issue(
  p_lot_id        BIGINT,
  p_issue_type    VARCHAR,
  p_issue_desc    VARCHAR,
  p_reporter_id   BIGINT
) RETURNS BIGINT AS $$
BEGIN
  INSERT INTO receiving_issues (material_lot_id, issue_type, issue_desc, reported_by_id)
  VALUES (p_lot_id, p_issue_type, p_issue_desc, p_reporter_id)
  RETURNING id;
END;
$$ LANGUAGE plpgsql;
