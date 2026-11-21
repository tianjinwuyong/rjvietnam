-- MES/WMS durable exchange and reconciliation contract.
-- WMS owns inventory facts; MES owns production facts. Cross-system changes
-- travel as acknowledged, idempotent events and never as direct table writes.

ALTER TABLE inventory_transactions DROP CONSTRAINT IF EXISTS inventory_transactions_action_check;
ALTER TABLE inventory_transactions ADD CONSTRAINT inventory_transactions_action_check
  CHECK (action IN ('RECEIVE','IQC_RELEASE','IQC_HOLD','IQC_REJECT','PUT_AWAY','RESERVE','PICK',
                    'ISSUE_TO_LINE','RETURN_FROM_LINE','TRANSFER','SCRAP','ADJUST'));

CREATE TABLE IF NOT EXISTS mes_wms_exchange_events (
  event_id varchar(120) PRIMARY KEY,
  direction varchar(20) NOT NULL CHECK (direction IN ('MES_TO_WMS','WMS_TO_MES')),
  owner varchar(10) NOT NULL CHECK (owner IN ('MES','WMS')),
  event_type varchar(80) NOT NULL,
  entity_type varchar(40) NOT NULL,
  entity_key varchar(160) NOT NULL,
  source_node varchar(80) NOT NULL,
  destination_node varchar(80) NOT NULL,
  schema_version integer NOT NULL DEFAULT 1,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  delivery_state varchar(20) NOT NULL DEFAULT 'PENDING'
    CHECK (delivery_state IN ('PENDING','DELIVERING','ACKNOWLEDGED','QUARANTINED')),
  attempt_count integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mes_wms_exchange_delivery
  ON mes_wms_exchange_events(delivery_state, created_at);
CREATE INDEX IF NOT EXISTS idx_mes_wms_exchange_entity
  ON mes_wms_exchange_events(entity_type, entity_key, created_at DESC);

CREATE TABLE IF NOT EXISTS mes_wms_reconciliation_runs (
  id bigserial PRIMARY KEY,
  work_order_code varchar(80),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  status varchar(20) NOT NULL DEFAULT 'RUNNING'
    CHECK (status IN ('RUNNING','MATCHED','DIFFERENCE','REVIEWED')),
  issued_qty numeric(18,4) NOT NULL DEFAULT 0,
  consumed_qty numeric(18,4) NOT NULL DEFAULT 0,
  returned_qty numeric(18,4) NOT NULL DEFAULT 0,
  scrap_qty numeric(18,4) NOT NULL DEFAULT 0,
  difference_qty numeric(18,4) NOT NULL DEFAULT 0,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  reviewed_by bigint REFERENCES users(id),
  reviewed_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_mes_wms_reconciliation_wo
  ON mes_wms_reconciliation_runs(work_order_code, started_at DESC);
