-- =============================================================================
-- 346: flow_webhook_outbox（public）补齐 manual_retry_count —— 与 oa schema 同形
-- =============================================================================
-- 背景（实测，非推断）：
--   这张表的**权威版本在 `oa` schema**（本地 + prod 均存在，OA 池 search_path=oa,public
--   永远优先解析它）。迁移 343 在 public 另建了一份，立论「表不存在」当时是误判 ——
--   已在 docs/WMS_GRAFT_LOG.md 的 ⚠ 修正条目记录。
--   343 受 append-only 保护不能删，于是把 public 这份补成与 oa 同形，消除分叉隐患：
--   少了 manual_retry_count 时，若 search_path 变化或有人写死 public.flow_webhook_outbox，
--   services/api/src/oa/services/integration-reconcile.js:45,48,139,147 会直接
--   `column "manual_retry_count" does not exist`。
--   列定义取自 oa 表实测：integer NOT NULL DEFAULT 0（对账自动补发计数，上限 MAX_AUTO_RETRY=3）。
--
-- 影响面：public.flow_webhook_outbox 今天没有任何代码路径解析到，因此本迁移是纯对齐，
--   不改变任何现有行为；也不动 oa 表、不动数据。

ALTER TABLE flow_webhook_outbox
  ADD COLUMN IF NOT EXISTS manual_retry_count integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN flow_webhook_outbox.manual_retry_count IS
  '对账自动补发次数计数（上限 3；与 oa.flow_webhook_outbox 同形，防止 public 版本被解析到时缺列）';
