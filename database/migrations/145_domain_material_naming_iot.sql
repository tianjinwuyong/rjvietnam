-- Canonical domain registry, material naming governance and IoT registry.

CREATE TABLE IF NOT EXISTS system_domains (
  domain_code varchar(40) PRIMARY KEY,
  name_zh varchar(120) NOT NULL,
  name_en varchar(120) NOT NULL,
  name_vi varchar(120) NOT NULL,
  system_owner varchar(40) NOT NULL,
  description text,
  status varchar(20) NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status IN ('ACTIVE','INACTIVE','LOCKED'))
);

INSERT INTO system_domains(domain_code,name_zh,name_en,name_vi,system_owner,description) VALUES
 ('RAW_MATERIAL','原材料域','Raw Material Domain','Miền nguyên vật liệu','WMS','Materials, supplier lots, IQC and material inventory movements'),
 ('FINISHED_GOODS','成品域','Finished Goods Domain','Miền thành phẩm','WMS','Finished-product SN, carton, pallet and shipment inventory'),
 ('MES_PRODUCTION','生产执行域','MES Production Domain','Miền thực thi sản xuất','MES','Work orders, routing, station facts and SN history'),
 ('IOT','物联网域','IoT Domain','Miền IoT','IOT','Device identity, heartbeat, telemetry and alarms')
ON CONFLICT(domain_code) DO UPDATE SET
 name_zh=excluded.name_zh,name_en=excluded.name_en,name_vi=excluded.name_vi,
 system_owner=excluded.system_owner,description=excluded.description,updated_at=now();

ALTER TABLE materials ADD COLUMN IF NOT EXISTS domain_code varchar(40) REFERENCES system_domains(domain_code);
ALTER TABLE materials ADD COLUMN IF NOT EXISTS naming_version integer NOT NULL DEFAULT 1;
ALTER TABLE materials ADD COLUMN IF NOT EXISTS naming_status varchar(20) NOT NULL DEFAULT 'APPROVED';
UPDATE materials SET domain_code='RAW_MATERIAL' WHERE domain_code IS NULL;
ALTER TABLE materials ALTER COLUMN domain_code SET NOT NULL;
-- Fresh-install seeds predate this column; default new rows to the same
-- backfill value so pre-145 seed data inserts keep working.
ALTER TABLE materials ALTER COLUMN domain_code SET DEFAULT 'RAW_MATERIAL';

ALTER TABLE products ADD COLUMN IF NOT EXISTS domain_code varchar(40) REFERENCES system_domains(domain_code);
UPDATE products SET domain_code='FINISHED_GOODS' WHERE domain_code IS NULL;
ALTER TABLE products ALTER COLUMN domain_code SET NOT NULL;
ALTER TABLE products ALTER COLUMN domain_code SET DEFAULT 'FINISHED_GOODS';

ALTER TABLE bom_lines ADD COLUMN IF NOT EXISTS material_naming_version integer;
UPDATE bom_lines bl SET material_naming_version=m.naming_version
FROM materials m WHERE m.id=bl.material_id AND bl.material_naming_version IS NULL;
ALTER TABLE bom_lines ALTER COLUMN material_naming_version SET NOT NULL;

ALTER TABLE wms_warehouses ADD COLUMN IF NOT EXISTS domain_code varchar(40) REFERENCES system_domains(domain_code);
UPDATE wms_warehouses SET domain_code=CASE WHEN warehouse_type='FINISHED_GOODS' THEN 'FINISHED_GOODS' ELSE 'RAW_MATERIAL' END WHERE domain_code IS NULL;

CREATE TABLE IF NOT EXISTS material_name_aliases (
  id bigserial PRIMARY KEY,
  material_id bigint NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  alias_type varchar(30) NOT NULL,
  alias_value varchar(240) NOT NULL,
  language_code varchar(10),
  source_system varchar(60),
  status varchar(20) NOT NULL DEFAULT 'ACTIVE',
  created_by bigint REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(alias_type,alias_value),
  CHECK(alias_type IN ('LEGACY_CODE','SUPPLIER_CODE','CUSTOMER_CODE','NAME','BARCODE'))
);

CREATE TABLE IF NOT EXISTS material_naming_change_requests (
  id bigserial PRIMARY KEY,
  request_no varchar(80) NOT NULL UNIQUE,
  material_id bigint NOT NULL REFERENCES materials(id),
  proposed_code varchar(80),
  proposed_name_zh varchar(160),proposed_name_en varchar(160),proposed_name_vi varchar(160),
  reason text NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'PENDING',
  requested_by bigint REFERENCES users(id),approved_by bigint REFERENCES users(id),
  requested_at timestamptz NOT NULL DEFAULT now(),decided_at timestamptz,
  CHECK(status IN ('PENDING','APPROVED','REJECTED','CANCELLED'))
);

CREATE TABLE IF NOT EXISTS bom_material_review_queue (
  id bigserial PRIMARY KEY,
  bom_id bigint NOT NULL REFERENCES boms(id),
  material_id bigint NOT NULL REFERENCES materials(id),
  old_naming_version integer NOT NULL,
  new_naming_version integer NOT NULL,
  reason varchar(80) NOT NULL DEFAULT 'MATERIAL_NAMING_CHANGED',
  status varchar(20) NOT NULL DEFAULT 'PENDING',
  reviewed_by bigint REFERENCES users(id),reviewed_at timestamptz,comments text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(bom_id,material_id,new_naming_version),
  CHECK(status IN ('PENDING','APPROVED','REJECTED'))
);

CREATE TABLE IF NOT EXISTS iot_device_registry (
  device_id varchar(160) PRIMARY KEY,
  device_name varchar(160) NOT NULL,
  device_type varchar(60) NOT NULL,
  domain_code varchar(40) NOT NULL REFERENCES system_domains(domain_code),
  station_id bigint REFERENCES stations(id),
  line_id bigint REFERENCES production_lines(id),
  ip_address inet,
  protocol varchar(30) NOT NULL DEFAULT 'HTTP',
  data_owner varchar(40) NOT NULL,
  firmware_version varchar(80),agent_version varchar(80),
  status varchar(20) NOT NULL DEFAULT 'ACTIVE',
  last_heartbeat_at timestamptz,
  registered_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(status IN ('ACTIVE','OFFLINE','MAINTENANCE','RETIRED'))
);

CREATE TABLE IF NOT EXISTS iot_telemetry_events (
  event_id varchar(200) PRIMARY KEY,
  device_id varchar(160) NOT NULL REFERENCES iot_device_registry(device_id),
  domain_code varchar(40) NOT NULL REFERENCES system_domains(domain_code),
  event_type varchar(60) NOT NULL,
  metric_name varchar(120),numeric_value numeric(20,6),text_value text,
  unit varchar(30),quality varchar(20) NOT NULL DEFAULT 'GOOD',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL,received_at timestamptz NOT NULL DEFAULT now(),
  CHECK(quality IN ('GOOD','UNCERTAIN','BAD'))
);

CREATE INDEX IF NOT EXISTS idx_material_alias_material ON material_name_aliases(material_id,status);
CREATE INDEX IF NOT EXISTS idx_material_naming_requests_status ON material_naming_change_requests(status,requested_at);
CREATE INDEX IF NOT EXISTS idx_bom_material_review_pending ON bom_material_review_queue(status,created_at);
CREATE INDEX IF NOT EXISTS idx_iot_device_domain_station ON iot_device_registry(domain_code,station_id,status);
CREATE INDEX IF NOT EXISTS idx_iot_telemetry_device_time ON iot_telemetry_events(device_id,occurred_at DESC);

CREATE OR REPLACE VIEW v_material_canonical_names AS
SELECT m.id,m.code AS official_code,m.name_zh,m.name_en,m.name_vi,m.uom,m.material_type,
       m.domain_code,m.naming_version,m.naming_status,
       COALESCE(jsonb_agg(jsonb_build_object('type',a.alias_type,'value',a.alias_value,'language',a.language_code))
         FILTER(WHERE a.id IS NOT NULL),'[]'::jsonb) AS aliases
FROM materials m LEFT JOIN material_name_aliases a ON a.material_id=m.id AND a.status='ACTIVE'
GROUP BY m.id;

CREATE OR REPLACE FUNCTION enforce_bom_material_domain_and_version()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE material_domain varchar(40); current_version integer;
BEGIN
  SELECT domain_code,naming_version INTO material_domain,current_version FROM materials WHERE id=NEW.material_id;
  IF material_domain IS DISTINCT FROM 'RAW_MATERIAL' THEN
    RAISE EXCEPTION 'BOM components must belong to RAW_MATERIAL domain';
  END IF;
  NEW.material_naming_version:=current_version;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_bom_material_domain_version ON bom_lines;
CREATE TRIGGER trg_bom_material_domain_version
BEFORE INSERT OR UPDATE OF material_id ON bom_lines
FOR EACH ROW EXECUTE FUNCTION enforce_bom_material_domain_and_version();

CREATE OR REPLACE FUNCTION queue_bom_review_after_material_rename()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.naming_version > OLD.naming_version THEN
    INSERT INTO bom_material_review_queue(bom_id,material_id,old_naming_version,new_naming_version)
    SELECT DISTINCT bl.bom_id,NEW.id,OLD.naming_version,NEW.naming_version
    FROM bom_lines bl JOIN boms b ON b.id=bl.bom_id
    WHERE bl.material_id=NEW.id AND b.status='active'
    ON CONFLICT(bom_id,material_id,new_naming_version) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_material_rename_bom_review ON materials;
CREATE TRIGGER trg_material_rename_bom_review
AFTER UPDATE OF naming_version ON materials
FOR EACH ROW EXECUTE FUNCTION queue_bom_review_after_material_rename();

CREATE OR REPLACE VIEW v_bom_canonical_materials AS
SELECT b.id AS bom_id,b.revision,b.status AS bom_status,p.code AS product_code,p.domain_code AS product_domain,
       bl.id AS bom_line_id,m.id AS material_id,m.code AS official_material_code,
       m.name_zh,m.name_en,m.name_vi,m.domain_code AS material_domain,
       bl.material_naming_version,m.naming_version AS current_naming_version,
       (bl.material_naming_version=m.naming_version) AS naming_version_current,
       bl.qty_per,bl.loss_rate
FROM boms b JOIN products p ON p.id=b.product_id
JOIN bom_lines bl ON bl.bom_id=b.id JOIN materials m ON m.id=bl.material_id;
