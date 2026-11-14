-- =============================================================
-- MES → WMS 工单 / 领料单接入（2026-10-31）
-- 对应 MES 接口文档：WMS工单下发接口_对接文档_20261030.md（v1.0）
-- 执行：psql -h localhost -U postgres -d wms -f server/database/mes-integration-20261031.sql
-- 幂等：全部 IF NOT EXISTS，可重复执行
-- =============================================================

BEGIN;

-- -------------------------------------------------------------
-- 1. work_order 扩展：MES 来源标识 + MES 原样字段
--    设计原则：工单号直接沿用 MES 的 moNo，不另造号；
--    MES 字段只做“附加信息”，WMS 原有状态机与流程完全不变。
-- -------------------------------------------------------------
ALTER TABLE work_order ADD COLUMN IF NOT EXISTS source        varchar(20) NOT NULL DEFAULT 'manual';
ALTER TABLE work_order ADD COLUMN IF NOT EXISTS mes_mo_no     varchar(50);
ALTER TABLE work_order ADD COLUMN IF NOT EXISTS mes_status    varchar(20);
ALTER TABLE work_order ADD COLUMN IF NOT EXISTS product_model varchar(200);
ALTER TABLE work_order ADD COLUMN IF NOT EXISTS wo_type       varchar(20);
ALTER TABLE work_order ADD COLUMN IF NOT EXISTS line_code     varchar(50);
ALTER TABLE work_order ADD COLUMN IF NOT EXISTS po_no         varchar(50);
ALTER TABLE work_order ADD COLUMN IF NOT EXISTS cust_code     varchar(50);
ALTER TABLE work_order ADD COLUMN IF NOT EXISTS plan_start    date;
ALTER TABLE work_order ADD COLUMN IF NOT EXISTS plan_end      date;
ALTER TABLE work_order ADD COLUMN IF NOT EXISTS panel_count   integer;
ALTER TABLE work_order ADD COLUMN IF NOT EXISTS mes_updated_at timestamptz(3);
ALTER TABLE work_order ADD COLUMN IF NOT EXISTS mes_synced_at  timestamptz(3);
-- MES 侧已开的领料单（只读展示，WMS 不据此改自己的单据）
ALTER TABLE work_order ADD COLUMN IF NOT EXISTS mes_issue_no     varchar(100);
ALTER TABLE work_order ADD COLUMN IF NOT EXISTS mes_issue_status varchar(20);
ALTER TABLE work_order ADD COLUMN IF NOT EXISTS mes_issue_count  integer;

-- 同一张 MES 工单只能落一条 WMS 工单
CREATE UNIQUE INDEX IF NOT EXISTS uq_wo_mes_mo
  ON work_order (mes_mo_no) WHERE mes_mo_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wo_source ON work_order (source);
CREATE INDEX IF NOT EXISTS idx_wo_line   ON work_order (line_code);

-- -------------------------------------------------------------
-- 2. 领料单扩展：来源标记 + MES 领料单号
--    用 (work_order_id, work_section, source) 唯一约束保证「重复同步不重复开单」
-- -------------------------------------------------------------
ALTER TABLE picking_order ADD COLUMN IF NOT EXISTS source       varchar(20) NOT NULL DEFAULT 'manual';
ALTER TABLE picking_order ADD COLUMN IF NOT EXISTS mes_issue_no varchar(100);

CREATE UNIQUE INDEX IF NOT EXISTS uq_picking_mes_section
  ON picking_order (work_order_id, work_section)
  WHERE source = 'mes' AND status <> 'cancelled';

-- -------------------------------------------------------------
-- 3. MES 用料明细缓存
--    为什么要落地：MES 的 /materials 只给当前值，没有历史；
--    WMS 生成领料单、算齐套、事后追溯都需要「那一刻的需求快照」。
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mes_work_order_material (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mo_no           varchar(50)  NOT NULL,
  work_section    varchar(20)  NOT NULL DEFAULT 'smt',
  material_code   varchar(100) NOT NULL,
  material_name   varchar(200),
  specification   text,
  unit            varchar(20)  DEFAULT 'PCS',
  qty_per         numeric(18,4) DEFAULT 0,
  need_qty        numeric(18,4) DEFAULT 0,
  issue_qty       numeric(18,4) DEFAULT 0,
  open_qty        numeric(18,4) DEFAULT 0,
  mpq             numeric(18,4) DEFAULT 1,
  suggest_qty     numeric(18,4) DEFAULT 0,
  pos_ref         varchar(200),
  alt_list        text,
  is_alt          boolean DEFAULT false,
  -- issue=来自 MES 已开领料单（真实需求）；bom=BOM 现算（理论用量）
  src_type        varchar(20)  DEFAULT 'bom',
  segment_raw     varchar(20),
  material_id     uuid,
  synced_at       timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- 系统字段：全库统一带下划线前缀，与 schema.ts 的 _created_at/_updated_at 对齐
  _created_at     timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_at     timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_mes_mat
  ON mes_work_order_material (mo_no, material_code, COALESCE(pos_ref, ''));
CREATE INDEX IF NOT EXISTS idx_mes_mat_mo ON mes_work_order_material (mo_no);
CREATE INDEX IF NOT EXISTS idx_mes_mat_code ON mes_work_order_material (material_code);

-- -------------------------------------------------------------
-- 4. 同步游标 / 运行日志
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mes_sync_state (
  sync_key        varchar(50) PRIMARY KEY,
  cursor_updated  timestamptz(3),
  last_run_at     timestamptz(3),
  last_ok_at      timestamptz(3),
  last_status     varchar(20),
  last_message    text,
  last_request_id varchar(64),
  updated_at      timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS mes_sync_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task        varchar(30)  NOT NULL,
  status      varchar(20)  NOT NULL,
  pulled      integer DEFAULT 0,
  created     integer DEFAULT 0,
  updated     integer DEFAULT 0,
  skipped     integer DEFAULT 0,
  failed      integer DEFAULT 0,
  message     text,
  request_id  varchar(64),
  started_at  timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at timestamptz(3)
);

CREATE INDEX IF NOT EXISTS idx_mes_log_started ON mes_sync_log (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_mes_log_task ON mes_sync_log (task, started_at DESC);

INSERT INTO mes_sync_state (sync_key) VALUES ('work_order')
  ON CONFLICT (sync_key) DO NOTHING;

-- -------------------------------------------------------------
-- 5. 菜单权限：MES 接入页给计划 / 仓库 / 生产主管开放
--    写法与 iqc-template-menu-permission-20261020.sql 一致（并集，可重复执行）
-- -------------------------------------------------------------
UPDATE sys_role
   SET menu_permissions = ARRAY(
     SELECT DISTINCT unnest(
       COALESCE(menu_permissions, ARRAY[]::text[]) || ARRAY['/mes', '/mes/sync']::text[]
     )
   )
 WHERE role_code IN ('wh_manager', 'wh_keeper', 'planner', 'plan_manager', 'production_manager');

COMMIT;

-- -------------------------------------------------------------
-- 回滚（如需）：
--   DROP TABLE IF EXISTS mes_sync_log, mes_sync_state, mes_work_order_material;
--   DROP INDEX IF EXISTS uq_picking_mes_section;
--   ALTER TABLE picking_order DROP COLUMN IF EXISTS source, DROP COLUMN IF EXISTS mes_issue_no;
--   DROP INDEX IF EXISTS uq_wo_mes_mo, idx_wo_source, idx_wo_line;
--   ALTER TABLE work_order DROP COLUMN IF EXISTS source, mes_mo_no, mes_status, ...
-- -------------------------------------------------------------
