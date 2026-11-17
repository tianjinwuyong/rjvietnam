-- Migration 260: PDA User App Access Control
-- Authorizes MENG_YING and MO_LI_BIN to assign PDA app roles to any user
-- Required by: services/api/src/auth/index.ts (management role grants hr.department.manage + related perms)

BEGIN;

-- ── 1. pda_app_catalog ──────────────────────────────────────────────
-- Master list of PDA application roles that managers can assign.
-- This is the authoritative catalog shown in the auth UI.
CREATE TABLE IF NOT EXISTS pda_app_catalog (
  id          BIGSERIAL PRIMARY KEY,
  app_key     VARCHAR(64)  NOT NULL UNIQUE,
  name_zh     VARCHAR(128) NOT NULL,
  name_en     VARCHAR(128) NOT NULL DEFAULT '',
  name_vi     VARCHAR(128) NOT NULL DEFAULT '',
  description TEXT,
  icon        VARCHAR(64),
  sort_order  INT          NOT NULL DEFAULT 0,
  is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pda_app_catalog_active ON pda_app_catalog(is_active) WHERE is_active = TRUE;

COMMENT ON TABLE pda_app_catalog IS 'MES-authoritative catalog of PDA app roles that can be assigned to users';

-- ── 2. pda_user_apps ───────────────────────────────────────────────
-- Per-user PDA app access grants. One row per (user, app).
CREATE TABLE IF NOT EXISTS pda_user_apps (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT       NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  app_id      BIGINT       NOT NULL REFERENCES pda_app_catalog(id) ON DELETE CASCADE,
  granted_by  BIGINT       REFERENCES employees(id),
  granted_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ,
  notes       VARCHAR(255),
  status      VARCHAR(24)  NOT NULL DEFAULT 'ACTIVE'
                  CHECK (status IN ('ACTIVE', 'REVOKED')),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, app_id)
);

CREATE INDEX IF NOT EXISTS idx_pda_user_apps_user     ON pda_user_apps(user_id);
CREATE INDEX IF NOT EXISTS idx_pda_user_apps_app      ON pda_user_apps(app_id);
CREATE INDEX IF NOT EXISTS idx_pda_user_apps_status   ON pda_user_apps(status);
CREATE INDEX IF NOT EXISTS idx_pda_user_apps_expires  ON pda_user_apps(expires_at) WHERE expires_at IS NOT NULL;

COMMENT ON TABLE pda_user_apps IS 'Per-user PDA app access grants issued by MENG_YING or MO_LI_BIN';

-- ── 3. Audit view ──────────────────────────────────────────────────
CREATE OR REPLACE VIEW v_pda_user_app_assignments AS
SELECT
  ua.id,
  ua.status,
  ua.granted_at,
  ua.expires_at,
  ua.notes,
  e_user.code            AS user_code,
  e_user.display_name   AS user_name,
  e_user.name_zh        AS user_name_zh,
  ac.app_key,
  ac.name_zh           AS app_name_zh,
  ac.name_en           AS app_name_en,
  ac.name_vi           AS app_name_vi,
  ac.description       AS app_description,
  e_grantor.display_name AS granted_by_name
FROM pda_user_apps ua
JOIN employees       e_user   ON e_user.id = ua.user_id
JOIN pda_app_catalog ac      ON ac.id = ua.app_id
LEFT JOIN employees e_grantor ON e_grantor.id = ua.granted_by;

-- ── 4. Seed: pda_app_catalog ───────────────────────────────────────
INSERT INTO pda_app_catalog (app_key, name_zh, name_en, name_vi, description, sort_order) VALUES
  ('EMPLOYEE',           '普通员工',       'Employee Self-Service',       'Nhân viên thường',          '员工自助：打卡、考勤查看、请假提交、培训、公告',                1),
  ('MATERIAL_LOADER',    '上料员',         'Material Loader',             'Người nạp liệu',             'SMT/自动线上料扫码、绑定、换料、异常上报',                    10),
  ('SMT_LOADER',        'SMT上料员',      'SMT Feeder Loader',          'Người nạp liệu SMT',        'SMT上料： feeder绑定、换料、扫描、异常',                   11),
  ('AUTO_LOADER',       '自动线上料员',    'Auto Line Loader',          'Người nạp liệu dây tự động', '自动线上料： feeder绑定、换料、扫描',                         12),
  ('MANUAL_LOADER',     '手动线上料员',    'Manual Line Loader',        'Người nạp liệu dây thủ công','手动线上料： feeder绑定、换料、扫描',                       13),
  ('WAREHOUSE',         '仓库人员',       'Warehouse Operator',         'Nhân viên kho',              '仓库：收货、发货、库存查询、领料',                          20),
  ('MATERIAL_FETCHER',  '叫料员',         'Material Fetcher',          'Người gọi liệu',             'WMS叫料：查看叫料队列、FIFO取料、交接',                     21),
  ('MATERIAL_COLLECTOR', '配料员',         'Material Collector',        'Ngân liệu',                   '配料：查看配料单、扫描库位、确认配料',                        22),
  ('GROUP_LEADER',      '组长',           'Group Leader',              'Tổ trưởng',                  '组长：产线监控、报警确认、交接、团队管理',                  30),
  ('LINE_MANAGER',      '线长',           'Line Manager',             'Đốc công',                   '线长：工单分配、 loading放行、异常决策、团队、目标',         31),
  ('LINE_MANAGER_SMT',  'SMT线长',        'SMT Line Manager',         'Đốc công SMT',               'SMT线长专属：SMT产线管理、 loading放行',                    32),
  ('LINE_MANAGER_AUTO', '自动线线长',      'Auto Line Manager',         'Đốc công dây tự động',      '自动线线长专属',                                           33),
  ('LINE_MANAGER_MANUAL','手动线线长',     'Manual Line Manager',       'Đốc công dây thủ công',      '手动线线长专属',                                           34),
  ('IQC',               'IQC检验员',      'IQC Inspector',            'Nhân viên IQC',               'IQC：来料检验、质量判定、不良处理',                        40),
  ('PMC',               '生产计划员',      'Production Planner',        'Nhân viên kế hoạch',         'PMC：生产计划、工单发布、目标管理',                        41),
  ('MES',               'MES操作员',      'MES Operator',              'Operator MES',                'MES：工单控制、路线验证、审批协调',                        42),
  ('ENGINEERING',       '工程技术人员',   'Engineering',              'Kỹ sư',                       '工程：设备维护、工艺支持、紧急物料审批',                    43),
  ('PRODUCTION',        '生产管理员',      'Production Manager',        'Quản lý sản xuất',           '生产：执行监控、停机恢复、物料审批',                        44),
  ('PLANT_MANAGER',     '厂长',           'Plant Manager',            'Giám đốc nhà máy',           '厂长：最终审批、异常授权、工厂监管',                        45),
  ('ADMIN',             '系统管理员',      'System Administrator',     'Quản trị viên',               '系统管理：系统配置、用户权限、审计',                        99)
ON CONFLICT (app_key) DO UPDATE SET
  name_zh = EXCLUDED.name_zh,
  name_en = EXCLUDED.name_en,
  name_vi = EXCLUDED.name_vi,
  description = EXCLUDED.description,
  sort_order = EXCLUDED.sort_order;

COMMIT;
