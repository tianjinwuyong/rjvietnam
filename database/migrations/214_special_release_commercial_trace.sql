BEGIN;

-- One immutable commercial/quality trace per used NG special release.  The
-- downstream documents resolve this record by SN/work order instead of
-- copying approval facts into multiple modules.
CREATE TABLE IF NOT EXISTS special_release_commercial_trace (
  trace_id BIGSERIAL PRIMARY KEY,
  exemption_id BIGINT NOT NULL UNIQUE REFERENCES ng_special_exemptions(exemption_id),
  sn VARCHAR(160) NOT NULL,
  carton_sn VARCHAR(160),
  work_order_id BIGINT REFERENCES work_orders(id),
  work_order_code VARCHAR(80),
  customer_po_id BIGINT REFERENCES customer_pos(id),
  sales_order_id BIGINT REFERENCES sales_orders(id),
  sales_order_line_id BIGINT REFERENCES sales_order_lines(id),
  source_station VARCHAR(64) NOT NULL,
  ng_reason TEXT,
  approval_reason TEXT NOT NULL,
  approved_by_username VARCHAR(80) NOT NULL,
  approved_by_name VARCHAR(160) NOT NULL,
  approved_at TIMESTAMPTZ NOT NULL,
  used_station VARCHAR(64) NOT NULL,
  used_at TIMESTAMPTZ NOT NULL,
  commercial_disposition VARCHAR(32) NOT NULL DEFAULT 'SPECIAL_RELEASE'
    CHECK (commercial_disposition IN ('SPECIAL_RELEASE','NORMAL_SALE','MARKET_TEST','DISCOUNT_SALE','CUSTOMER_ACCEPTED','AFTER_SALES_WATCH','HOLD','RECALL')),
  attention_level VARCHAR(16) NOT NULL DEFAULT 'WATCH'
    CHECK (attention_level IN ('WATCH','HIGH','CRITICAL','CLOSED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_special_release_trace_sn
  ON special_release_commercial_trace(UPPER(sn));
CREATE INDEX IF NOT EXISTS idx_special_release_trace_wo
  ON special_release_commercial_trace(work_order_id, work_order_code);
CREATE INDEX IF NOT EXISTS idx_special_release_trace_so
  ON special_release_commercial_trace(sales_order_id);
CREATE INDEX IF NOT EXISTS idx_special_release_trace_po
  ON special_release_commercial_trace(customer_po_id);

CREATE TABLE IF NOT EXISTS special_release_disposition_events (
  event_id BIGSERIAL PRIMARY KEY,
  trace_id BIGINT NOT NULL REFERENCES special_release_commercial_trace(trace_id) ON DELETE CASCADE,
  disposition VARCHAR(32) NOT NULL
    CHECK (disposition IN ('SPECIAL_RELEASE','NORMAL_SALE','MARKET_TEST','DISCOUNT_SALE','CUSTOMER_ACCEPTED','AFTER_SALES_WATCH','HOLD','RECALL')),
  discount_percent NUMERIC(7,4),
  decision_reason TEXT NOT NULL,
  customer_ack_reference VARCHAR(160),
  decided_by BIGINT REFERENCES users(id),
  decided_by_name VARCHAR(160) NOT NULL,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_special_release_disposition_trace
  ON special_release_disposition_events(trace_id,decided_at DESC);

-- A single read model used by Sales, WMS/outbound, delivery/loading and
-- after-sales.  Links that are created later appear automatically.
CREATE OR REPLACE VIEW v_special_release_full_trace AS
SELECT t.*,
       so.so_no,
       cpo.po_number AS customer_po_no,
       fg.id AS finished_goods_id,
       fg.status AS finished_goods_status,
       oi.outbound_order_id,
       oo.outbound_no,
       oo.status AS outbound_status,
       oo.logistics_no,
       s.id AS shipment_id,
       s.shipment_no,
       s.status AS shipment_status,
       r.id AS rma_id,
       r.rma_no,
       r.status AS rma_status
FROM special_release_commercial_trace t
LEFT JOIN sales_orders so ON so.id=t.sales_order_id
LEFT JOIN customer_pos cpo ON cpo.id=t.customer_po_id
LEFT JOIN wms_finished_goods fg ON UPPER(fg.sn_no)=UPPER(t.sn)
LEFT JOIN wms_outbound_items oi ON UPPER(oi.sn_no)=UPPER(t.sn)
LEFT JOIN wms_outbound_orders oo ON oo.id=oi.outbound_order_id
LEFT JOIN shipment_lines sl ON sl.work_order_id=t.work_order_id
LEFT JOIN shipments s ON s.id=sl.shipment_id AND s.customer_po_id=t.customer_po_id
LEFT JOIN rma_requests r ON UPPER(r.serial_no)=UPPER(t.sn);

COMMIT;
