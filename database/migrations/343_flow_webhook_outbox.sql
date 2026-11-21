-- =============================================================================
-- 343: flow_webhook_outbox —— OA 审批出站 Webhook 发件箱
-- =============================================================================
-- 背景：services/api/src/oa/services/wms-webhook.js 自 2026-09 起就在
-- INSERT / UPDATE 这张表（enqueueWmsEvent / dispatchWmsOutbox / reclaimStuck），
-- 但此前没有任何迁移或启动 DDL 创建它 —— prod 的 OA「集成告警扫描」cron
-- 每轮报错 relation "flow_webhook_outbox" does not exist。
-- 本迁移为纯增量建表，不改任何现有行为；列集与消费者代码逐一对齐：
--   INSERT: instance_id, event, system_code, target_url, payload
--   认领:   status='pending' AND next_retry_at <= now()
--           → SET status='sending', claimed_at=now(), attempts=attempts+1
--   成功:   status='sent', last_error=NULL, claimed_at=NULL
--   失败:   attempts 沿用认领时 +1 的值；status='pending'（未耗尽）或 'failed'；
--           next_retry_at = now() + delay
--   回收:   status='sending' AND claimed_at < now() - 10min
-- 状态机: pending → sending → sent | failed（failed 终态，人工处理）

CREATE TABLE IF NOT EXISTS flow_webhook_outbox (
  id            bigserial PRIMARY KEY,
  instance_id   bigint       NOT NULL,                -- flow_instance.id（该表本身尚无迁移，故不加 FK）
  event         varchar(64)  NOT NULL,                -- 事件名，如 approval.completed
  system_code   varchar(32)  NOT NULL,                -- 目标业务系统代码，如 WMS
  target_url    text         NOT NULL,
  payload       jsonb        NOT NULL DEFAULT '{}'::jsonb,
  status        varchar(16)  NOT NULL DEFAULT 'pending',
  attempts      int          NOT NULL DEFAULT 0,
  next_retry_at timestamptz  NOT NULL DEFAULT now(),
  claimed_at    timestamptz,
  last_error    text,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT flow_webhook_outbox_status_check
    CHECK (status IN ('pending','sending','sent','failed'))
);

-- 投递轮询主查询：WHERE status='pending' AND next_retry_at <= now() ORDER BY id
CREATE INDEX IF NOT EXISTS idx_flow_webhook_outbox_poll
  ON flow_webhook_outbox (status, next_retry_at, id);
-- 按审批实例追溯事件
CREATE INDEX IF NOT EXISTS idx_flow_webhook_outbox_instance
  ON flow_webhook_outbox (instance_id);

COMMENT ON TABLE flow_webhook_outbox IS
  'OA 审批出站 Webhook 发件箱：与业务同事务写入，独立任务轮询投递，HMAC 签名（消费者: services/api/src/oa/services/wms-webhook.js）';

-- ── ownership（迁移以 postgres 跑，应用以 smt_factory 连）──────────────────
do $$
begin
  alter table flow_webhook_outbox owner to smt_factory;
exception when undefined_object then
  raise notice 'smt_factory role missing; ownership left as-is';
end $$;
