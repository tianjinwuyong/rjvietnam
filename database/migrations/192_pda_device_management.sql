-- PDA Device Management — unified asset lifecycle for all handheld PDA devices
-- Covers: receiving, assignment, storage, maintenance, procurement, audit
-- All timestamps in TIMESTAMPTZ, all codes VARCHAR, multilingual name fields

BEGIN;

-- ── 1. PDA Device Master ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pda_devices (
  id              BIGSERIAL PRIMARY KEY,
  device_code     VARCHAR(64)  NOT NULL UNIQUE,      -- e.g. "PDA-SMT-001"
  serial_no       VARCHAR(128) NOT NULL UNIQUE,       -- hardware serial / IMEI
  device_model    VARCHAR(128) NOT NULL,              -- e.g. "Zebra TC26", "Chainway C6"
  manufacturer    VARCHAR(128),
  imei            VARCHAR(64),
  mac_address     VARCHAR(64),
  android_version VARCHAR(32),                         -- e.g. "11.0"
  app_package     VARCHAR(128),                        -- e.g. "com.smt.materialloader"
  app_version     VARCHAR(32),                         -- current installed app version
  firmware_version VARCHAR(64),
  cpu_arch        VARCHAR(16),                         -- "arm64-v8a", "armeabi-v7a"
  ram_mb          INT,
  storage_gb      INT,
  battery_capacity_mah INT,

  -- Status & lifecycle
  device_status   VARCHAR(24) NOT NULL DEFAULT 'IN_STOCK'
                  CHECK (device_status IN (
                    'IN_STOCK',       -- 在库
                    'ASSIGNED',       -- 已发放
                    'LOST',           -- 丢失
                    'DAMAGED',        -- 损坏
                    'IN_REPAIR',      -- 维修中
                    'RETIRED',        -- 报废
                    'QUARANTINED'     -- 隔离待检
                  )),
  assigned_to     VARCHAR(80),                         -- badge / employee code currently holding it
  assigned_at     TIMESTAMPTZ,
  location        VARCHAR(256),                        -- current physical location
  line_code       VARCHAR(32),                         -- assigned production line

  -- Purchase info
  purchase_order  VARCHAR(64),
  supplier        VARCHAR(256),
  purchase_price  NUMERIC(18,2),
  purchase_date   DATE,
  warranty_expiry DATE,

  -- Meta
  notes           TEXT,
  name_zh         VARCHAR(256),
  name_en         VARCHAR(256),
  name_vi         VARCHAR(256),
  created_by      VARCHAR(80)  NOT NULL DEFAULT 'SYSTEM',
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pda_devices_status     ON pda_devices(device_status);
CREATE INDEX IF NOT EXISTS idx_pda_devices_line_code  ON pda_devices(line_code);
CREATE INDEX IF NOT EXISTS idx_pda_devices_assigned   ON pda_devices(assigned_to);

-- ── 2. PDA Assignment / Transfer History ─────────────────────────────
CREATE TABLE IF NOT EXISTS pda_assignments (
  id              BIGSERIAL PRIMARY KEY,
  device_id       BIGINT       NOT NULL REFERENCES pda_devices(id),
  action          VARCHAR(24)  NOT NULL
                  CHECK (action IN (
                    'RECEIVE',      -- 入库/领取
                    'ASSIGN',       -- 发放给人
                    'RETURN',       -- 归还
                    'TRANSFER',     -- 转交
                    'LOSS_REPORT',  -- 挂失
                    'DAMAGE_REPORT' -- 损坏报备
                  )),
  from_person     VARCHAR(80),                         -- badge of previous holder / supplier
  to_person       VARCHAR(80),                         -- badge of new holder
  from_line       VARCHAR(32),
  to_line         VARCHAR(32),
  reason          TEXT,
  operator_badge  VARCHAR(80)  NOT NULL,               -- who performed the action
  operator_name   VARCHAR(256),
  occurred_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pda_assignments_device ON pda_assignments(device_id);
CREATE INDEX IF NOT EXISTS idx_pda_assignments_person ON pda_assignments(to_person);

-- ── 3. PDA Repair / Maintenance Records ────────────────────────────
CREATE TABLE IF NOT EXISTS pda_repairs (
  id              BIGSERIAL PRIMARY KEY,
  device_id       BIGINT       NOT NULL REFERENCES pda_devices(id),
  repair_code     VARCHAR(64)  NOT NULL UNIQUE,        -- e.g. "RPR-PDA-20260724-001"
  reported_by     VARCHAR(80)  NOT NULL,               -- badge who reported the issue
  reported_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  issue_desc      TEXT         NOT NULL,
  issue_category  VARCHAR(32)  NOT NULL
                  CHECK (issue_category IN (
                    'HARDWARE',       -- 硬件故障
                    'SOFTWARE',       -- 软件问题
                    'SCREEN',         -- 屏幕损坏
                    'BATTERY',        -- 电池问题
                    'SCANNER',        -- 扫描头故障
                    'NETWORK',        -- 网络连接
                    'CHARGING',       -- 充电故障
                    'OTHER'           -- 其他
                  )),
  severity        VARCHAR(16)  NOT NULL DEFAULT 'MINOR'
                  CHECK (severity IN ('CRITICAL','MAJOR','MINOR')),
  repair_status   VARCHAR(24)  NOT NULL DEFAULT 'REPORTED'
                  CHECK (repair_status IN (
                    'REPORTED',       -- 已报修
                    'DIAGNOSING',     -- 检测中
                    'REPAIRING',      -- 维修中
                    'REPAIRED',       -- 已修复
                    'CLOSED',         -- 已结案
                    'UNREPAIRABLE'    -- 无法修复
                  )),
  assigned_to     VARCHAR(80),                         -- repair technician badge
  diagnosis       TEXT,
  repair_action   TEXT,
  parts_used      TEXT,
  repair_cost     NUMERIC(18,2),
  repair_hours    NUMERIC(6,2),
  completed_at    TIMESTAMPTZ,
  verified_by     VARCHAR(80),                         -- QA verification after repair
  verified_at     TIMESTAMPTZ,
  notes           TEXT,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pda_repairs_device   ON pda_repairs(device_id);
CREATE INDEX IF NOT EXISTS idx_pda_repairs_status   ON pda_repairs(repair_status);

-- ── 4. PDA Software Update / Version Log ────────────────────────────
CREATE TABLE IF NOT EXISTS pda_software_versions (
  id              BIGSERIAL PRIMARY KEY,
  device_id       BIGINT       NOT NULL REFERENCES pda_devices(id),
  previous_version VARCHAR(32),
  new_version     VARCHAR(32)  NOT NULL,
  apk_file_name   VARCHAR(256),
  apk_hash        VARCHAR(128),
  apk_size_bytes  BIGINT,
  update_method   VARCHAR(24)  NOT NULL
                  CHECK (update_method IN ('OTA','MANUAL','SIDELOAD','AUTO')),
  release_notes   TEXT,
  installed_by    VARCHAR(80)  NOT NULL,
  installed_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  success         BOOLEAN      NOT NULL DEFAULT TRUE,
  error_log       TEXT
);

CREATE INDEX IF NOT EXISTS idx_pda_sw_versions_device ON pda_software_versions(device_id);

-- ── 5. PDA Operation Audit Log ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS pda_audit_log (
  id              BIGSERIAL PRIMARY KEY,
  device_id       BIGINT       REFERENCES pda_devices(id),
  device_code     VARCHAR(64),
  event_type      VARCHAR(32)  NOT NULL
                  CHECK (event_type IN (
                    'SCAN',           -- 扫码
                    'BIND',           -- 绑定工单
                    'RELEASE',        -- 放行
                    'LOGIN',          -- 登录
                    'LOGOUT',         -- 登出
                    'HEARTBEAT',      -- 心跳
                    'ERROR',          -- 错误
                    'SYNC',           -- 数据同步
                    'CONFIG_CHANGE',  -- 配置变更
                    'APP_START',      -- 应用启动
                    'APP_CRASH'       -- 应用崩溃
                  )),
  operator_badge  VARCHAR(80),
  operator_name   VARCHAR(256),
  station_code    VARCHAR(64),
  line_code       VARCHAR(32),
  work_order_code VARCHAR(32),
  payload         JSONB,
  result          VARCHAR(16),                         -- PASS / FAIL / ERROR
  error_message   TEXT,
  client_ts       TIMESTAMPTZ,                         -- timestamp from the device
  server_ts       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pda_audit_device    ON pda_audit_log(device_id);
CREATE INDEX IF NOT EXISTS idx_pda_audit_type       ON pda_audit_log(event_type);
CREATE INDEX IF NOT EXISTS idx_pda_audit_operator   ON pda_audit_log(operator_badge);
CREATE INDEX IF NOT EXISTS idx_pda_audit_server_ts  ON pda_audit_log(server_ts DESC);

-- ── 6. PDA Synchronization Status View ──────────────────────────────
CREATE OR REPLACE VIEW pda_device_status_view AS
SELECT
  d.id,
  d.device_code,
  d.serial_no,
  d.device_model,
  d.manufacturer,
  d.android_version,
  d.app_version,
  d.device_status,
  d.assigned_to,
  d.line_code,
  d.location,
  d.purchase_date,
  d.warranty_expiry,
  d.name_zh,
  d.name_en,
  d.name_vi,
  a.operator_name AS current_holder_name,
  r.repair_status AS active_repair_status,
  r.issue_desc    AS active_repair_issue,
  sw.new_version  AS last_installed_version,
  sw.installed_at AS last_software_update,
  al.event_type   AS last_event_type,
  al.server_ts    AS last_event_at,
  al.operator_badge AS last_operator,
  d.created_at
FROM pda_devices d
LEFT JOIN pda_assignments a ON a.device_id = d.id AND a.id = (
  SELECT MAX(a2.id) FROM pda_assignments a2 WHERE a2.device_id = d.id
)
LEFT JOIN pda_repairs r ON r.device_id = d.id AND r.repair_status NOT IN ('CLOSED','UNREPAIRABLE') AND r.id = (
  SELECT MAX(r2.id) FROM pda_repairs r2 WHERE r2.device_id = d.id AND r2.repair_status NOT IN ('CLOSED','UNREPAIRABLE')
)
LEFT JOIN pda_software_versions sw ON sw.device_id = d.id AND sw.id = (
  SELECT MAX(sw2.id) FROM pda_software_versions sw2 WHERE sw2.device_id = d.id
)
LEFT JOIN pda_audit_log al ON al.device_id = d.id AND al.id = (
  SELECT MAX(al2.id) FROM pda_audit_log al2 WHERE al2.device_id = d.id
);

COMMIT;
