-- =============================================================================
-- 392: 运行中 WMS / OA 的动态同步适配器 —— 日志、菜单快照、OA 回调幂等
-- =============================================================================
-- 背景（2026-11-21 实测，非推断）：
--   运行中的 WMS 在 100.107.212.49:18080（NestJS，登录 POST /api/system/login
--   {account,password}，列表信封 {items,page,pageSize,total}，菜单 = 登录返回的
--   menuPermissions 62 项）；运行中的 OA 在同机 :8090/:8000（登录 POST
--   /api/auth/login {username,password}，信封 {code,msg,data}，会话 token 24h，
--   单据列表 GET /api/instances?tab=flow → data.{list,page,size,total}）。
--   工厂服务器 rjms（100.116.166.118）是同步目标。
--
-- 本迁移只建「同步基础设施」，不搬业务数据：
--   ① live_sync_log   —— 每轮拉取的运行日志（形状对齐 mes_sync_log，344）
--   ② live_menu_snapshot —— 源系统菜单/流程定义快照（菜单漂移检测的锚）
--   ③ oa_callback_log —— OA 审批回调幂等日志（参考 WMS
--      oa-integration-20261021.sql 的同名表；本侧 instance id 是字符串
--      `OA-<biz>-<ts>`，故用 text 而非参考的 bigint）
--   ④ integration_app 补 base_url（341 种子留空；只补空值，不覆盖已有配置）
--
-- 数据面约定（与 datasources.js 的 ext_<code> 同一原则）：
--   拉下来的源数据落 sync_stage.live_<app>__<endpoint>（jsonb 原样 + 拉取时间），
--   绝不直接写业务表；canonical 收敛由 one-WMS slice 链按既有决策推进。
--   sync_stage schema 若不存在则建（322 的快照曾手工建过，prod 没有）。
--
-- 归属: 迁移以 postgres 跑、应用以 smt_factory 连 —— pg_default_acl 为空，
--       不显式改 owner 会得到「对表 xxx 权限不够」(500)。见 333 的教训。
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS sync_stage;

-- ── ① 运行日志 ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS live_sync_log (
    id          BIGSERIAL PRIMARY KEY,
    app         TEXT NOT NULL,                 -- wms-rjvn / oa-portal
    task        TEXT NOT NULL,                 -- menu / inventory / picking / iqc / instances / flows
    status      TEXT NOT NULL,                 -- success | partial | failed | skipped
    pulled      INTEGER NOT NULL DEFAULT 0,
    created     INTEGER NOT NULL DEFAULT 0,
    updated     INTEGER NOT NULL DEFAULT 0,
    skipped     INTEGER NOT NULL DEFAULT 0,
    failed      INTEGER NOT NULL DEFAULT 0,
    message     TEXT,
    started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_live_sync_log_app ON live_sync_log(app, started_at DESC);

-- ── ② 源菜单/流程定义快照（漂移检测的锚）────────────────────────────────────
CREATE TABLE IF NOT EXISTS live_menu_snapshot (
    id          BIGSERIAL PRIMARY KEY,
    app         TEXT NOT NULL,
    kind        TEXT NOT NULL DEFAULT 'menu',  -- menu | flow-defs | permissions
    payload     JSONB NOT NULL,
    item_count  INTEGER NOT NULL DEFAULT 0,
    digest      TEXT NOT NULL,                 -- sha256(payload)，变了才算漂移
    fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_live_menu_snapshot_app ON live_menu_snapshot(app, fetched_at DESC);

-- ── ③ OA 回调幂等日志 ───────────────────────────────────────────────────────
-- 参考形状（oa-integration-20261021.sql）：UNIQUE(oa_instance_id,event,node_index)。
-- 本侧 oa_integration_outbox.oa_instance_id 是 varchar（305），故 text。
-- node_index 可空；UNIQUE 用 NULLS NOT DISTINCT（PG15+）保证空节点也去重。
CREATE TABLE IF NOT EXISTS oa_callback_log (
    id              BIGSERIAL PRIMARY KEY,
    oa_instance_id  TEXT NOT NULL,
    event           VARCHAR(30) NOT NULL,
    node_index      INTEGER,
    biz_type        VARCHAR(50),
    biz_key         VARCHAR(100),
    payload         JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE NULLS NOT DISTINCT (oa_instance_id, event, node_index)
);
CREATE INDEX IF NOT EXISTS idx_oa_callback_log_biz ON oa_callback_log(biz_type, biz_key);

-- ── ④ integration_app 补出站基址（只补空值）─────────────────────────────────
UPDATE integration_app SET base_url = 'http://100.107.212.49:18080', updated_at = now()
 WHERE code = 'wms-rjvn' AND base_url = '';
UPDATE integration_app SET base_url = 'http://100.107.212.49:8090', updated_at = now()
 WHERE code = 'oa-portal' AND base_url = '';

-- ── ownership（333 的教训：不改 owner = 应用角色 500）──────────────────────
DO $$
DECLARE
  app_role text := coalesce(nullif(current_setting('smt.app_role', true), ''), 'smt_factory');
  t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = app_role) THEN
    RAISE NOTICE 'role % missing; skipping ownership transfer', app_role;
    RETURN;
  END IF;
  EXECUTE format('ALTER SCHEMA sync_stage OWNER TO %I', app_role);
  FOREACH t IN ARRAY ARRAY['live_sync_log','live_menu_snapshot','oa_callback_log'] LOOP
    EXECUTE format('ALTER TABLE public.%I OWNER TO %I', t, app_role);
    EXECUTE format('ALTER SEQUENCE public.%I OWNER TO %I', t || '_id_seq', app_role);
  END LOOP;
END $$;