-- WMS 对接 OA（2026-10-21）
BEGIN;
ALTER TABLE picking_order
  ADD COLUMN IF NOT EXISTS oa_instance_id bigint,
  ADD COLUMN IF NOT EXISTS oa_status varchar(20),
  ADD COLUMN IF NOT EXISTS oa_synced_at timestamptz(3);

ALTER TABLE sys_account ADD COLUMN IF NOT EXISTS oa_user_id bigint;

-- 回调幂等表：同一实例同一事件同一节点只处理一次
CREATE TABLE IF NOT EXISTS oa_callback_log (
  id bigserial PRIMARY KEY,
  oa_instance_id bigint NOT NULL,
  event varchar(30) NOT NULL,
  node_index int,
  biz_type varchar(50),
  biz_key varchar(100),
  payload jsonb,
  _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (oa_instance_id, event, node_index)
);
COMMIT;
