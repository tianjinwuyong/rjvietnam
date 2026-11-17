BEGIN;

CREATE TABLE IF NOT EXISTS mes_route_configurations (
  id BIGSERIAL PRIMARY KEY,
  revision VARCHAR(80) NOT NULL UNIQUE,
  schema_version VARCHAR(20) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','PENDING_APPROVAL','APPROVED','PUBLISHED','RETIRED','REJECTED')),
  source_reference TEXT,
  configuration JSONB NOT NULL,
  change_reason TEXT NOT NULL,
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_by BIGINT REFERENCES users(id),
  submitted_at TIMESTAMPTZ,
  approved_by BIGINT REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  published_by BIGINT REFERENCES users(id),
  published_at TIMESTAMPTZ,
  effective_from TIMESTAMPTZ,
  retired_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (approved_by IS NULL OR approved_by IS DISTINCT FROM created_by)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_mes_route_configuration_published
  ON mes_route_configurations ((status)) WHERE status='PUBLISHED';
CREATE INDEX IF NOT EXISTS idx_mes_route_configuration_status_created
  ON mes_route_configurations(status, created_at DESC);

CREATE TABLE IF NOT EXISTS mes_route_configuration_history (
  id BIGSERIAL PRIMARY KEY,
  route_configuration_id BIGINT NOT NULL REFERENCES mes_route_configurations(id),
  action VARCHAR(40) NOT NULL,
  from_status VARCHAR(24),
  to_status VARCHAR(24),
  reason TEXT NOT NULL,
  actor_id BIGINT REFERENCES users(id),
  snapshot JSONB NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mes_route_configuration_history_route
  ON mes_route_configuration_history(route_configuration_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS mes_ng_tracking_events (
  id BIGSERIAL PRIMARY KEY,
  event_id VARCHAR(160) NOT NULL UNIQUE,
  idempotency_key VARCHAR(200) NOT NULL UNIQUE,
  product_id VARCHAR(80) NOT NULL REFERENCES mes_product_units(product_id),
  dependent_sequence_id VARCHAR(80) REFERENCES mes_product_dependent_sequences(sequence_id),
  route_configuration_id BIGINT NOT NULL REFERENCES mes_route_configurations(id),
  route_policy_code VARCHAR(80) NOT NULL,
  event_type VARCHAR(40) NOT NULL CHECK (event_type IN
    ('NG_CONFIRMED','ROUTE_ASSIGNED','TRANSFER_STARTED','DESTINATION_RECEIVED',
     'REPAIR_STARTED','REPAIR_COMPLETED','RETURN_STARTED','RETURN_RECEIVED',
     'RETEST_STARTED','RETEST_PASSED','RETEST_FAILED','QUALITY_RELEASED','SCRAPPED')),
  from_station_code VARCHAR(64),
  destination_station_code VARCHAR(64),
  tracking_state VARCHAR(32) NOT NULL CHECK (tracking_state IN
    ('CONFIRMED','AWAITING_TRANSFER','IN_TRANSFER','RECEIVED','IN_REPAIR',
     'AWAITING_RETURN','IN_RETURN','AWAITING_RETEST','RETESTING','RELEASED','SCRAPPED')),
  actor_type VARCHAR(24) NOT NULL CHECK (actor_type IN ('OPERATOR','DEVICE','MES','SYSTEM')),
  actor_id VARCHAR(120) NOT NULL,
  station_code VARCHAR(64),
  agent_id VARCHAR(160),
  host_ip VARCHAR(64),
  reason_code VARCHAR(80) NOT NULL,
  authorization_id VARCHAR(120),
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  mes_acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mes_ng_tracking_product_time
  ON mes_ng_tracking_events(product_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_mes_ng_tracking_destination_state
  ON mes_ng_tracking_events(destination_station_code, tracking_state, occurred_at DESC);

CREATE TABLE IF NOT EXISTS mes_ng_tracking_current (
  product_id VARCHAR(80) PRIMARY KEY REFERENCES mes_product_units(product_id),
  dependent_sequence_id VARCHAR(80) REFERENCES mes_product_dependent_sequences(sequence_id),
  confirmed_ng_event_id VARCHAR(160) NOT NULL,
  latest_event_id VARCHAR(160) NOT NULL,
  route_configuration_id BIGINT NOT NULL REFERENCES mes_route_configurations(id),
  route_policy_code VARCHAR(80) NOT NULL,
  tracking_state VARCHAR(32) NOT NULL,
  current_station_code VARCHAR(64),
  expected_station_code VARCHAR(64),
  repair_case_id VARCHAR(120),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version BIGINT NOT NULL DEFAULT 1
);

INSERT INTO permissions(code,name_zh,name_en,name_vi,module,description,category)
VALUES
 ('mes.route.configure','配置 MES 路由','Configure MES routes','Cấu hình tuyến MES','mes','Create and edit draft station and NG routes','mes'),
 ('mes.route.approve','审批 MES 路由','Approve MES routes','Phê duyệt tuyến MES','mes','Approve a route revision created by another user','mes'),
 ('mes.route.publish','发布 MES 路由','Publish MES routes','Phát hành tuyến MES','mes','Publish an approved route revision to Station Agents','mes')
ON CONFLICT(code) DO UPDATE SET
 name_zh=EXCLUDED.name_zh,name_en=EXCLUDED.name_en,name_vi=EXCLUDED.name_vi,
 module=EXCLUDED.module,description=EXCLUDED.description,category=EXCLUDED.category;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.code IN ('admin','management')
  AND p.code IN ('mes.route.configure','mes.route.approve','mes.route.publish')
ON CONFLICT DO NOTHING;

COMMIT;
