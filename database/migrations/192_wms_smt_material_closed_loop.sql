BEGIN;

CREATE TABLE IF NOT EXISTS material_process_classifications(
  material_id BIGINT PRIMARY KEY REFERENCES materials(id) ON DELETE RESTRICT,
  process_domain VARCHAR(24) NOT NULL CHECK(process_domain IN('SMT_MATERIAL','NON_SMT_MATERIAL')),
  tracking_level VARCHAR(24) NOT NULL CHECK(tracking_level IN('REEL_SN','LOT','CONTAINER','BULK')),
  consumption_source VARCHAR(24) NOT NULL CHECK(consumption_source IN('NPM','MES','STATION','MANUAL_APPROVED')),
  requires_feeder BOOLEAN NOT NULL DEFAULT FALSE,
  requires_msd_control BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','FROZEN','RETIRED')),
  classified_by VARCHAR(80) NOT NULL,
  reason TEXT NOT NULL,
  classified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS smt_material_flow_events(
  id BIGSERIAL PRIMARY KEY,
  event_key UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  source_table VARCHAR(64) NOT NULL,
  source_id BIGINT NOT NULL,
  event_type VARCHAR(32) NOT NULL CHECK(event_type IN(
    'RECEIVED','IQC_RELEASED','PUTAWAY','RESERVED','ISSUED','BOUND','CONSUMED',
    'REJECTED','REEL_CHANGED','UNBOUND','RETURNED','SCRAPPED','RECONCILED'
  )),
  work_order_code VARCHAR(50),
  machine_code VARCHAR(64),
  slot_no VARCHAR(32),
  feeder_code VARCHAR(64),
  material_code VARCHAR(80),
  material_sn VARCHAR(128),
  lot_no VARCHAR(80),
  qty NUMERIC(18,4) NOT NULL DEFAULT 0,
  actor VARCHAR(80) NOT NULL DEFAULT 'SYSTEM',
  payload JSONB NOT NULL DEFAULT '{}',
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(source_table,source_id,event_type)
);

CREATE TABLE IF NOT EXISTS smt_material_flow_exceptions(
  id BIGSERIAL PRIMARY KEY,
  exception_no VARCHAR(48) NOT NULL UNIQUE,
  exception_type VARCHAR(32) NOT NULL CHECK(exception_type IN(
    'UNCLASSIFIED_MATERIAL','BINDING_MISMATCH','NPM_UNMATCHED','NEGATIVE_BALANCE',
    'BOM_VARIANCE','MSD_BLOCKED','IQC_BLOCKED','EXPIRY_BLOCKED','OFFLINE_VIOLATION'
  )),
  severity VARCHAR(12) NOT NULL CHECK(severity IN('WARNING','BLOCK','CRITICAL')),
  work_order_code VARCHAR(50),
  material_code VARCHAR(80),
  material_sn VARCHAR(128),
  source_ref VARCHAR(128),
  detail JSONB NOT NULL DEFAULT '{}',
  status VARCHAR(20) NOT NULL DEFAULT 'OPEN' CHECK(status IN('OPEN','INVESTIGATING','RESOLVED','VOIDED')),
  owner_domain VARCHAR(24) NOT NULL DEFAULT 'WMS',
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by VARCHAR(80),
  resolution TEXT
);

CREATE INDEX IF NOT EXISTS idx_smt_flow_wo_time ON smt_material_flow_events(work_order_code,occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_smt_flow_reel_time ON smt_material_flow_events(material_sn,occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_smt_exception_open ON smt_material_flow_exceptions(status,severity,detected_at);

CREATE OR REPLACE FUNCTION capture_smt_feeder_binding_flow() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    INSERT INTO smt_material_flow_events(source_table,source_id,event_type,work_order_code,machine_code,slot_no,feeder_code,material_code,material_sn,lot_no,qty,payload)
    VALUES('feeder_binding_events',NEW.id,'BOUND',NEW.work_order_code,NEW.machine_code,NEW.slot_no,NEW.feeder_code,NEW.material_code,NEW.material_sn,NEW.lot_no,COALESCE(NEW.qty,0),to_jsonb(NEW))
    ON CONFLICT DO NOTHING;
  ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.status='unbound' THEN
    INSERT INTO smt_material_flow_events(source_table,source_id,event_type,work_order_code,machine_code,slot_no,feeder_code,material_code,material_sn,lot_no,payload)
    VALUES('feeder_binding_events',NEW.id,'UNBOUND',NEW.work_order_code,NEW.machine_code,NEW.slot_no,NEW.feeder_code,NEW.material_code,NEW.material_sn,NEW.lot_no,to_jsonb(NEW))
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_capture_smt_binding_flow ON feeder_binding_events;
CREATE TRIGGER trg_capture_smt_binding_flow AFTER INSERT OR UPDATE OF status ON feeder_binding_events
FOR EACH ROW EXECUTE FUNCTION capture_smt_feeder_binding_flow();

CREATE OR REPLACE FUNCTION capture_smt_npm_flow() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO smt_material_flow_events(source_table,source_id,event_type,work_order_code,machine_code,slot_no,feeder_code,material_sn,qty,payload,occurred_at)
  VALUES('npm_material_consumption_events',NEW.id,'CONSUMED',NEW.work_order_code,NEW.machine_code,NEW.slot_no,NEW.feeder_code,NEW.material_sn,NEW.placed_qty,to_jsonb(NEW),NEW.source_occurred_at)
  ON CONFLICT DO NOTHING;
  IF NEW.reconciliation_status<>'MATCHED' THEN
    INSERT INTO smt_material_flow_exceptions(exception_no,exception_type,severity,work_order_code,material_sn,source_ref,detail)
    VALUES('SMT-'||to_char(clock_timestamp(),'YYYYMMDDHH24MISSMS')||'-'||NEW.id,'NPM_UNMATCHED','BLOCK',NEW.work_order_code,NEW.material_sn,NEW.source_event_id,to_jsonb(NEW))
    ON CONFLICT(exception_no) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_capture_smt_npm_flow ON npm_material_consumption_events;
CREATE TRIGGER trg_capture_smt_npm_flow AFTER INSERT ON npm_material_consumption_events
FOR EACH ROW EXECUTE FUNCTION capture_smt_npm_flow();

INSERT INTO _migrations(filename,hash)
VALUES('192_wms_smt_material_closed_loop.sql','wms-smt-material-closed-loop-v1')
ON CONFLICT(filename) DO NOTHING;
COMMIT;
