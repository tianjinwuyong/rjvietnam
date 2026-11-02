-- ============================================================================
-- MES 发料结果回写队列（2026-10-31）
-- ----------------------------------------------------------------------------
-- 背景：MES 工单结案要按「实际发料数量」结算，现有 MES 接口是只读的，
--       WMS 侧必须先可靠地攒住发料事件，等 MES 开放写接口后按序推送。
--
-- 为什么单独建表而不是在 picking_order 上加几列：
--   1. 回写是「事件」，一张单会有 issued / received / returned 多次，
--      业务表放一列状态表达不了多个事件的生命周期；
--   2. 需要记录重试次数、下次重试时间、最后一次错误，业务表不该被这些污染；
--   3. 运维要能看到「哪些没推成功、为什么」，独立表最好查。
--
-- 幂等：(picking_id, event_type) 唯一。补发/重发料时 ON CONFLICT 重置为
--       pending，把最新快照再推一次（MES 侧按 idempotency_key 去重）。
-- ============================================================================

CREATE TABLE IF NOT EXISTS mes_issue_writeback (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  picking_id    uuid NOT NULL,
  picking_no    varchar(50) NOT NULL,
  -- issued = 发料完成；received = 产线签收；returned = 产线退料（预留）
  event_type    varchar(20) NOT NULL DEFAULT 'issued',
  -- pending 待推 / sent 已成功 / failed 超过重试上限 / skipped 不满足回写条件
  status        varchar(20) NOT NULL DEFAULT 'pending',
  attempts      integer NOT NULL DEFAULT 0,
  next_retry_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_error    text,
  -- 推送时的快照，便于事后核对「当时发的到底是什么」
  payload       jsonb,
  request_id    varchar(64),
  sent_at       timestamptz(3),
  _created_at   timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_at   timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS mes_issue_writeback_picking_event_key
  ON mes_issue_writeback (picking_id, event_type);

-- 后台任务按 (status, next_retry_at) 扫待推的
CREATE INDEX IF NOT EXISTS idx_miw_status_retry
  ON mes_issue_writeback (status, next_retry_at);

CREATE INDEX IF NOT EXISTS idx_miw_picking_no
  ON mes_issue_writeback (picking_no);

-- 菜单权限：回写看板跟 MES 同步同权限
UPDATE sys_role
   SET menu_permissions = ARRAY(
     SELECT DISTINCT unnest(
       COALESCE(menu_permissions, ARRAY[]::text[]) || ARRAY['/mes/writeback']::text[]
     )
   )
 WHERE role_code IN ('admin', 'wh_manager', 'planner', 'plan_manager', 'production_manager');

-- 配置项：回写开关，默认关闭（MES 写接口未开放前不产生无谓失败）
INSERT INTO sys_param (param_key, param_value, param_name_zh, description)
VALUES ('mes.writeback_enabled', 'false', 'MES 发料回写', '开启后 WMS 发料完成会把实发明细推给 MES，用于 MES 工单结案')
ON CONFLICT (param_key) DO NOTHING;
