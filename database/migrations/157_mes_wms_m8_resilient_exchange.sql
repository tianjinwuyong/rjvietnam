-- M8 resilient MES/WMS exchange: explicit ownership, replay cursor and conflicts.
ALTER TABLE mes_wms_exchange_events ADD COLUMN IF NOT EXISTS payload_hash varchar(64);
ALTER TABLE mes_wms_exchange_events ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE mes_wms_exchange_events ADD COLUMN IF NOT EXISTS delivering_at timestamptz;
ALTER TABLE mes_wms_exchange_events ADD COLUMN IF NOT EXISTS consumer_node varchar(80);
ALTER TABLE mes_wms_exchange_events ADD COLUMN IF NOT EXISTS quarantine_reason text;

UPDATE mes_wms_exchange_events SET payload_hash=md5(payload::text) WHERE payload_hash IS NULL;
ALTER TABLE mes_wms_exchange_events ALTER COLUMN payload_hash SET NOT NULL;

CREATE TABLE IF NOT EXISTS mes_wms_event_catalog (
  event_type varchar(80) PRIMARY KEY,
  owner varchar(10) NOT NULL CHECK(owner IN('MES','WMS')),
  direction varchar(20) NOT NULL CHECK(direction IN('MES_TO_WMS','WMS_TO_MES')),
  entity_type varchar(40) NOT NULL,
  schema_version integer NOT NULL DEFAULT 1,
  acknowledgement_timeout_seconds integer NOT NULL DEFAULT 120,
  max_attempts integer NOT NULL DEFAULT 5,
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO mes_wms_event_catalog(event_type,owner,direction,entity_type) VALUES
 ('MATERIAL_ISSUED','WMS','WMS_TO_MES','MATERIAL_LOT'),
 ('MATERIAL_RETURNED','WMS','WMS_TO_MES','MATERIAL_LOT'),
 ('MATERIAL_CONSUMED','MES','MES_TO_WMS','WORK_ORDER'),
 ('WORK_ORDER_RELEASED','MES','MES_TO_WMS','WORK_ORDER'),
 ('PRODUCTION_SCRAP_RECORDED','MES','MES_TO_WMS','SN')
ON CONFLICT(event_type) DO NOTHING;

CREATE TABLE IF NOT EXISTS mes_wms_exchange_conflicts (
  id bigserial PRIMARY KEY,event_id varchar(120) NOT NULL,
  existing_payload_hash varchar(64) NOT NULL,incoming_payload_hash varchar(64) NOT NULL,
  existing_payload jsonb NOT NULL,incoming_payload jsonb NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','KEEP_EXISTING','ACCEPT_INCOMING')),
  detected_at timestamptz NOT NULL DEFAULT now(),decided_at timestamptz,decided_by bigint REFERENCES users(id),reason text
);

CREATE INDEX IF NOT EXISTS idx_mes_wms_exchange_retry ON mes_wms_exchange_events(delivery_state,next_attempt_at,created_at);
CREATE INDEX IF NOT EXISTS idx_mes_wms_exchange_conflict_status ON mes_wms_exchange_conflicts(status,detected_at);
