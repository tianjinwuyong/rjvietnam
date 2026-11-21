-- ============================================================
-- 047: Document Archives & Historical Tracing System
-- Creates archival infrastructure for all factory data with
-- 5-year retention, category-based organization, and
-- cross-domain analysis query support.
-- ============================================================

begin;

-- ── 1. Archive Categories (multi-level hierarchy) ────────────
-- Each category maps to a business domain / "virtual manager".
CREATE TABLE archive_categories (
  id          BIGSERIAL PRIMARY KEY,
  code        VARCHAR(50)  UNIQUE NOT NULL,
  name_zh     VARCHAR(200) NOT NULL,
  name_en     VARCHAR(200) NOT NULL,
  name_vi     VARCHAR(200) NOT NULL,
  parent_id   BIGINT REFERENCES archive_categories(id),
  sort_order  INT          NOT NULL DEFAULT 0,
  icon        VARCHAR(50),            -- icon key for frontend
  is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE archive_categories IS 'Multi-level category tree for organizing document archives by business domain. Top-level entries correspond to virtual manager roles.';

-- Top-level categories (parent_id = NULL)
INSERT INTO archive_categories (code, name_zh, name_en, name_vi, sort_order, icon) VALUES
  ('production',    '生产管理',   'Production',      'Sản xuất',         1,  'factory'),
  ('warehouse',     '仓储物流',   'Warehouse',       'Kho vận',          2,  'warehouse'),
  ('quality',       '质量管理',   'Quality',         'Chất lượng',       3,  'quality'),
  ('hr-equipment',  '人事设备',   'HR & Equipment',  'Nhân sự & Thiết bị', 4, 'people'),
  ('finance',       '财务管理',   'Finance',          'Tài chính',        5,  'finance'),
  ('engineering',   '工程工艺',   'Engineering',      'Kỹ thuật',         6,  'engineering'),
  ('customer',      '客户服务',   'Customer Service', 'Dịch vụ khách hàng',7, 'customer'),
  ('management',    '管理决策',   'Management',       'Quản lý',          8,  'dashboard'),
  ('system',        '系统管理',   'System',           'Hệ thống',         9,  'settings');

-- Sub-categories for Production
INSERT INTO archive_categories (code, name_zh, name_en, name_vi, parent_id, sort_order, icon)
SELECT 'prod-work-orders',   '工单进度',   'Work Orders',       'Lệnh sản xuất',    id, 1, 'assignment'
FROM archive_categories WHERE code = 'production';
INSERT INTO archive_categories (code, name_zh, name_en, name_vi, parent_id, sort_order, icon)
SELECT 'prod-oee',           'OEE 报表',   'OEE Report',        'Báo cáo OEE',       id, 2, 'speed'
FROM archive_categories WHERE code = 'production';
INSERT INTO archive_categories (code, name_zh, name_en, name_vi, parent_id, sort_order, icon)
SELECT 'prod-defect',        '缺陷分析',   'Defect Analysis',   'Phân tích lỗi',     id, 3, 'bug-report'
FROM archive_categories WHERE code = 'production';
INSERT INTO archive_categories (code, name_zh, name_en, name_vi, parent_id, sort_order, icon)
SELECT 'prod-yield',         '良率分析',   'Yield Analysis',    'Phân tích tỷ lệ đạt', id,4, 'chart'
FROM archive_categories WHERE code = 'production';

-- Sub-categories for Warehouse
INSERT INTO archive_categories (code, name_zh, name_en, name_vi, parent_id, sort_order, icon)
SELECT 'wh-inventory',       '库存台账',   'Inventory Ledger',  'Sổ cái tồn kho',    id, 1, 'inventory'
FROM archive_categories WHERE code = 'warehouse';
INSERT INTO archive_categories (code, name_zh, name_en, name_vi, parent_id, sort_order, icon)
SELECT 'wh-movement',        '物料移动',   'Material Movement', 'Di chuyển vật tư',  id, 2, 'move'
FROM archive_categories WHERE code = 'warehouse';
INSERT INTO archive_categories (code, name_zh, name_en, name_vi, parent_id, sort_order, icon)
SELECT 'wh-balance',         '物料结存',   'Material Balance',  'Cân đối vật tư',    id, 3, 'balance'
FROM archive_categories WHERE code = 'warehouse';

-- Sub-categories for Quality
INSERT INTO archive_categories (code, name_zh, name_en, name_vi, parent_id, sort_order, icon)
SELECT 'qa-iqc',             'IQC 检验',   'IQC Inspection',    'Kiểm tra IQC',      id, 1, 'input'
FROM archive_categories WHERE code = 'quality';
INSERT INTO archive_categories (code, name_zh, name_en, name_vi, parent_id, sort_order, icon)
SELECT 'qa-oqc',             'OQC 出货',   'OQC Inspection',    'Kiểm tra OQC',      id, 2, 'output'
FROM archive_categories WHERE code = 'quality';
INSERT INTO archive_categories (code, name_zh, name_en, name_vi, parent_id, sort_order, icon)
SELECT 'qa-aoi',             'AOI 检测',   'AOI Inspection',    'Kiểm tra AOI',      id, 3, 'scan'
FROM archive_categories WHERE code = 'quality';
INSERT INTO archive_categories (code, name_zh, name_en, name_vi, parent_id, sort_order, icon)
SELECT 'qa-spi',             'SPI 检测',   'SPI Inspection',    'Kiểm tra SPI',      id, 4, 'print'
FROM archive_categories WHERE code = 'quality';
INSERT INTO archive_categories (code, name_zh, name_en, name_vi, parent_id, sort_order, icon)
SELECT 'qa-delivery-risk',   '交付风险',   'Delivery Risk',     'Rủi ro giao hàng',  id, 5, 'warning'
FROM archive_categories WHERE code = 'quality';

-- Sub-categories for HR & Equipment
INSERT INTO archive_categories (code, name_zh, name_en, name_vi, parent_id, sort_order, icon)
SELECT 'hre-attendance',     '考勤汇总',   'Attendance',        'Chấm công',         id, 1, 'attendance'
FROM archive_categories WHERE code = 'hr-equipment';
INSERT INTO archive_categories (code, name_zh, name_en, name_vi, parent_id, sort_order, icon)
SELECT 'hre-equipment',      '设备管理',   'Equipment',         'Thiết bị',          id, 2, 'equipment'
FROM archive_categories WHERE code = 'hr-equipment';
INSERT INTO archive_categories (code, name_zh, name_en, name_vi, parent_id, sort_order, icon)
SELECT 'hre-maintenance',    '维护保养',   'Maintenance',       'Bảo trì',           id, 3, 'build'
FROM archive_categories WHERE code = 'hr-equipment';

-- Sub-categories for Finance
INSERT INTO archive_categories (code, name_zh, name_en, name_vi, parent_id, sort_order, icon)
SELECT 'fin-ar',             '应收账龄',   'AR Aging',          'Công nợ phải thu',  id, 1, 'arrow-up'
FROM archive_categories WHERE code = 'finance';
INSERT INTO archive_categories (code, name_zh, name_en, name_vi, parent_id, sort_order, icon)
SELECT 'fin-ap',             '应付账龄',   'AP Aging',          'Công nợ phải trả',  id, 2, 'arrow-down'
FROM archive_categories WHERE code = 'finance';

-- Sub-categories for Engineering
INSERT INTO archive_categories (code, name_zh, name_en, name_vi, parent_id, sort_order, icon)
SELECT 'eng-bom',            'BOM 管理',   'BOM Management',    'Quản lý BOM',       id, 1, 'list'
FROM archive_categories WHERE code = 'engineering';
INSERT INTO archive_categories (code, name_zh, name_en, name_vi, parent_id, sort_order, icon)
SELECT 'eng-process',        '工艺流程',   'Process Routes',    'Quy trình SX',      id, 2, 'route'
FROM archive_categories WHERE code = 'engineering';

-- Sub-categories for Customer
INSERT INTO archive_categories (code, name_zh, name_en, name_vi, parent_id, sort_order, icon)
SELECT 'cust-info',          '客户信息',   'Customer Info',     'Thông tin khách hàng', id,1,'contact'
FROM archive_categories WHERE code = 'customer';
INSERT INTO archive_categories (code, name_zh, name_en, name_vi, parent_id, sort_order, icon)
SELECT 'cust-orders',        '客户订单',   'Customer Orders',   'Đơn hàng khách',    id, 2, 'receipt'
FROM archive_categories WHERE code = 'customer';

-- Sub-categories for Management
INSERT INTO archive_categories (code, name_zh, name_en, name_vi, parent_id, sort_order, icon)
SELECT 'mgt-kpi',            'KPI 看板',   'KPI Dashboard',     'Bảng KPI',          id, 1, 'stars'
FROM archive_categories WHERE code = 'management';
INSERT INTO archive_categories (code, name_zh, name_en, name_vi, parent_id, sort_order, icon)
SELECT 'mgt-reports',        '综合报表',   'Aggregated Reports','Báo cáo tổng hợp',  id, 2, 'assessment'
FROM archive_categories WHERE code = 'management';

-- │  2. Document Archives (the actual archived data)         │
-- ──────────────────────────────────────────────────────────────
-- Every row is a point-in-time snapshot of a document, report,
-- or data export at a specific archival event.

CREATE TABLE document_archives (
  id                  BIGSERIAL    PRIMARY KEY,
  category_id         BIGINT       NOT NULL REFERENCES archive_categories(id),

  -- Identity
  archive_type        VARCHAR(50)  NOT NULL DEFAULT 'report',
    -- 'report', 'document', 'data-export', 'screenshot', 'attachment', 'manual'
  source_key          VARCHAR(100) NOT NULL,
    -- logical source identifier, e.g. 'work-order-progress', 'inventory-ledger'
  source_id           VARCHAR(100),
    -- optional FK reference to the source record, e.g. work_order code

  -- Multi-lingual title (auto-derived from source when NULL)
  title_zh            VARCHAR(500),
  title_en            VARCHAR(500),
  title_vi            VARCHAR(500),

  -- ── The archived payload ──────────────────────────────────
  -- JSONB so every archive type stores its natural shape.
  -- Reports store the row array; documents store content;
  -- exports store summary + download metadata.
  snapshot_data       JSONB        NOT NULL,
  row_count           INT          NOT NULL DEFAULT 0,
  file_size_bytes     BIGINT,

  -- Context captured at archive time
  parameter_snapshot  JSONB,
    -- { period: 'weekly', dateFrom: '2026-01-01', … }
  user_agent          VARCHAR(255),
    -- who/what triggered the archive ('system:scheduled', 'user:<username>')

  -- Retention
  archived_by         BIGINT       REFERENCES users(id),
  archived_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  expires_at          TIMESTAMPTZ,
    -- NULL = never expires; otherwise = archive + 5 years
  is_pinned           BOOLEAN      NOT NULL DEFAULT FALSE,
    -- pinned archives bypass auto-expiry

  -- Integrity
  checksum            VARCHAR(64),
    -- SHA-256 of snapshot_data::text for tamper detection

  -- Extension point
  metadata            JSONB,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_doc_archives_category    ON document_archives(category_id, archived_at DESC);
CREATE INDEX idx_doc_archives_source_key  ON document_archives(source_key, archived_at DESC);
CREATE INDEX idx_doc_archives_type        ON document_archives(archive_type, archived_at DESC);
CREATE INDEX idx_doc_archives_expires     ON document_archives(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX idx_doc_archives_pinned      ON document_archives(is_pinned) WHERE is_pinned = TRUE;
CREATE INDEX idx_doc_archives_gin         ON document_archives USING GIN (snapshot_data jsonb_path_ops);
  -- enables JSON path queries like snapshot_data @> '{"status":"released"}'

COMMENT ON TABLE  document_archives IS 'Point-in-time snapshots of all factory data/documents/reports with 5-year retention. Core table for historical tracing and trend analysis.';
COMMENT ON COLUMN document_archives.snapshot_data IS 'JSONB payload: report rows[], document body, export summary, etc. Use GIN index for JSON path queries.';
COMMENT ON COLUMN document_archives.checksum IS 'SHA-256 of snapshot_data::text for tamper verification.';
COMMENT ON COLUMN document_archives.expires_at IS 'Auto-expiry date (archived_at + 5 years). NULL = permanent, is_pinned bypasses expiry.';

-- │  3. Archive Snapshots (batch tracking)                  │
-- ──────────────────────────────────────────────────────────────
-- Records systematic archive runs (manual, scheduled, triggered).

CREATE TABLE archive_snapshots (
  id                BIGSERIAL    PRIMARY KEY,
  snapshot_type     VARCHAR(30)  NOT NULL DEFAULT 'manual',
    -- 'manual', 'scheduled:daily', 'scheduled:weekly', 'scheduled:monthly', 'triggered'
  category_id       BIGINT       REFERENCES archive_categories(id),
  source_key        VARCHAR(100),
    -- when non-NULL, this snapshot only archived a single source
  description       TEXT,
  total_archived    INT          NOT NULL DEFAULT 0,
  status            VARCHAR(20)  NOT NULL DEFAULT 'running',
    -- 'running', 'completed', 'partial', 'failed'
  error_message     TEXT,
  started_by        VARCHAR(100),    -- user code or 'system'
  started_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  completed_at      TIMESTAMPTZ,
  metadata          JSONB
);

CREATE INDEX idx_archive_snapshots_type ON archive_snapshots(snapshot_type, started_at DESC);
CREATE INDEX idx_archive_snapshots_cat  ON archive_snapshots(category_id, started_at DESC);

COMMENT ON TABLE archive_snapshots IS 'Batch archive operation log. Tracks systematic (scheduled/triggered) archival runs.';

-- │  4. Analysis Views (registered analysis queries)        │
-- ──────────────────────────────────────────────────────────────
-- Pre-registered queries for cross-domain trend analysis on
-- archived data. Users can also run ad-hoc queries.

CREATE TABLE archive_analysis_views (
  id                    BIGSERIAL    PRIMARY KEY,
  code                  VARCHAR(100) UNIQUE NOT NULL,
  name_zh               VARCHAR(200) NOT NULL,
  name_en               VARCHAR(200) NOT NULL,
  name_vi               VARCHAR(200) NOT NULL,
  description_zh        TEXT,
  description_en        TEXT,
  description_vi        TEXT,
  category_id           BIGINT       REFERENCES archive_categories(id),
  source_key            VARCHAR(100),
    -- NULL = cross-category; non-NULL = scoped to one source
  analysis_type         VARCHAR(30)  NOT NULL DEFAULT 'trend',
    -- 'trend', 'comparison', 'aggregation', 'drill-down', 'custom'
  query_definition      JSONB        NOT NULL,
    -- { timeColumn: 'archived_at', valueColumn: ..., groupBy: ..., filters: [...] }
  parameter_definitions JSONB,
    -- [{ name: 'period', type: 'select', options: ['daily','weekly','monthly'] }, ...]
  is_public             BOOLEAN      NOT NULL DEFAULT TRUE,
  created_by            BIGINT       REFERENCES users(id),
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_analysis_cat     ON archive_analysis_views(category_id);
CREATE INDEX idx_analysis_source  ON archive_analysis_views(source_key);

COMMENT ON TABLE archive_analysis_views IS 'Registered analysis queries for cross-domain trend analysis on historical archive data.';

-- │  5. Retention Policy Automation                         │
-- ──────────────────────────────────────────────────────────────
-- Default 5-year expiry for all archives.
-- Set expires_at = archived_at + INTERVAL '5 years' on INSERT
-- when no explicit expires_at is given.

CREATE OR REPLACE FUNCTION trg_archive_set_expiry()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.expires_at IS NULL AND NOT NEW.is_pinned THEN
    NEW.expires_at := NEW.archived_at + INTERVAL '5 years';
  END IF;
  -- Auto-derive checksum if not provided
  IF NEW.checksum IS NULL THEN
    NEW.checksum := encode(sha256(NEW.snapshot_data::text::bytea), 'hex');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_document_archives_expiry
  BEFORE INSERT ON document_archives
  FOR EACH ROW EXECUTE FUNCTION trg_archive_set_expiry();

-- │  6. Archive-to-Category mapping view for easier query   │
-- ──────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW v_archive_catalog AS
SELECT
  a.id,
  a.archive_type,
  a.source_key,
  a.source_id,
  COALESCE(a.title_zh, ac_p.name_zh || ' - ' || ac.name_zh) AS title_zh,
  COALESCE(a.title_en, ac_p.name_en || ' - ' || ac.name_en) AS title_en,
  COALESCE(a.title_vi, ac_p.name_vi || ' - ' || ac.name_vi) AS title_vi,
  ac.id           AS category_id,
  ac.code         AS category_code,
  ac_p.id         AS parent_category_id,
  ac_p.code       AS parent_category_code,
  a.row_count,
  a.archived_by,
  a.archived_at,
  a.expires_at,
  a.is_pinned,
  a.checksum,
  a.parameter_snapshot,
  a.metadata,
  CASE WHEN a.expires_at < NOW() THEN 'expired' ELSE 'active' END AS retention_status
FROM document_archives a
JOIN archive_categories ac      ON ac.id = a.category_id
LEFT JOIN archive_categories ac_p ON ac_p.id = ac.parent_id;

COMMENT ON VIEW v_archive_catalog IS 'Flattened archive catalog with category hierarchy and retention status.';

commit;
