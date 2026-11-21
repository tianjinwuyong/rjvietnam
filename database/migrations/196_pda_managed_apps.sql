-- PDA Managed Apps Registry — master catalog of all mobile/station apps in the factory
-- Covers: Android APKs, Electron desktop apps, Python station agents, web apps
-- Each row represents a known application deployed to one or more production lines
BEGIN;

CREATE TABLE IF NOT EXISTS pda_managed_apps (
  id              BIGSERIAL PRIMARY KEY,
  app_code        VARCHAR(64)  NOT NULL UNIQUE,          -- e.g. "SMT-PDA-LOADER", "AUTO-LINE-PDA", "STATION-AGENT"

  -- Multilingual names
  name_zh         VARCHAR(256) NOT NULL,
  name_en         VARCHAR(256) NOT NULL DEFAULT '',
  name_vi         VARCHAR(256) NOT NULL DEFAULT '',

  -- Classification
  app_type        VARCHAR(24)  NOT NULL
                  CHECK (app_type IN (
                    'ANDROID_APK',       -- Native Android APK
                    'ELECTRON',          -- Electron desktop app
                    'PYTHON_SCRIPT',     -- Python agent / script
                    'WEB_APP',           -- Web-based SPA
                    'CAPACITOR_APP'      -- Capacitor hybrid app (Android + web)
                  )),
  target_platform VARCHAR(64)  NOT NULL DEFAULT '',      -- e.g. "Android 11+", "Windows 10+", "Linux", "Web"
  description     TEXT,
  source_path     VARCHAR(512),                          -- relative path to source code

  -- Versioning
  current_version VARCHAR(32),
  release_notes   TEXT,
  last_released_at TIMESTAMPTZ,

  -- Association
  associated_lines TEXT[],                               -- array of line codes e.g. {"SMT","AUTO","MANUAL","LASER"}
  
  -- Lifecycle
  app_status      VARCHAR(16)  NOT NULL DEFAULT 'ACTIVE'
                  CHECK (app_status IN (
                    'ACTIVE',          -- 在用
                    'DEPRECATED',      -- 即将停用
                    'RETIRED',         -- 已停用
                    'IN_DEVELOPMENT'   -- 开发中
                  )),

  -- Meta
  notes           TEXT,
  created_by      VARCHAR(80)  NOT NULL DEFAULT 'SYSTEM',
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pda_managed_apps_type   ON pda_managed_apps(app_type);
CREATE INDEX IF NOT EXISTS idx_pda_managed_apps_status ON pda_managed_apps(app_status);

-- ── Seed: register all known factory mobile/station apps ────────────────
INSERT INTO pda_managed_apps (app_code, name_zh, name_en, app_type, target_platform, source_path, current_version, associated_lines, app_status)
VALUES
  ('SMT-PDA-LOADER',  'SMT PDA扫码上料',  'SMT PDA Material Loading',   'ANDROID_APK',
   'Android 11+', '001-SMT/(00)PDA扫码上料/androidpdamaterialloader', '1.0.0',
   ARRAY['SMT'], 'ACTIVE'),

  ('AUTO-LINE-PDA',   '自动线PDA扫码',     'Auto Line PDA Scanning',     'ANDROID_APK',
   'Android 11+', '002-自动线/(01)PDA扫码上料/androidpdamaterialloader', '1.0.0',
   ARRAY['AUTO'], 'ACTIVE'),

  ('MANUAL-LINE-PDA', '手动线PDA扫码',     'Manual Line PDA Scanning',   'ANDROID_APK',
   'Android 11+', '004-手动线/(01)PDA扫码上料/androidpdamaterialloader', '1.0.0',
   ARRAY['MANUAL'], 'ACTIVE'),

  ('SMT-STATION-AGENT',    'SMT工位代理',          'SMT Station Agent',         'PYTHON_SCRIPT',
   'Windows 10+', '001-SMT/smt_station_agent.py', '1.0.0',
   ARRAY['SMT'], 'ACTIVE'),

  ('AUTO-LINE-STATION',    '自动线工站核心',        'Auto Line Station Core',    'PYTHON_SCRIPT',
   'Windows 10+', '002-自动线/', '1.0.0',
   ARRAY['AUTO'], 'ACTIVE'),

  ('MANUAL-LINE-STATION',  '手动线工站核心',        'Manual Line Station Core',  'PYTHON_SCRIPT',
   'Windows 10+', '004-手动线/', '1.0.0',
   ARRAY['MANUAL'], 'ACTIVE'),

  ('STATION-AGENT-ELECTRON', '工位代理(Electron)', 'Station Agent (Electron)',   'ELECTRON',
   'Windows 10+', 'apps/station-agent', '0.1.0',
   ARRAY['SMT','AUTO','MANUAL','LASER'], 'ACTIVE'),

  ('SCANNER-TERMINAL',  '扫码终端',            'Scanner Terminal',           'CAPACITOR_APP',
   'Android 11+', 'apps/scanner-terminal', '0.1.0',
   ARRAY['SMT','AUTO','MANUAL','LASER'], 'ACTIVE'),

  ('DISPLAY-BOARD',     '看板显示',            'Display Board',              'WEB_APP',
   'Web (Windows)', 'apps/display-board', '0.1.0',
   ARRAY['SMT','AUTO','MANUAL','LASER'], 'ACTIVE'),

  ('REWORK-STATION-2D', '返修工位(2D)',        'Rework Station 2D',          'PYTHON_SCRIPT',
   'Windows 10+', '005-返修站+镭雕位/rework_2d_agent.py', '1.0.0',
   ARRAY['LASER'], 'ACTIVE'),

  ('REWORK-STATION-3D', '返修工位(3D)',        'Rework Station 3D',          'PYTHON_SCRIPT',
   'Windows 10+', '005-返修站+镭雕位/rework_qt_3d_agent.py', '1.0.0',
   ARRAY['LASER'], 'ACTIVE'),

  ('WAVE-SOLDER-HEARTBEAT', '波峰焊心跳代理',   'Wave Solder Heartbeat Agent','PYTHON_SCRIPT',
   'Windows 10+', '004-手动线/(01)PDA扫码上料/wave_solder_heartbeat_agent.py', '1.0.0',
   ARRAY['MANUAL'], 'ACTIVE');

COMMIT;
