-- ============================================================
-- OA 待检推送事件队列（WMS → OA）
--
-- 为什么用 outbox 而不是在收货事务里直接 fetch：
--   收货/生成批次是高频且关键的事务，任何外部 HTTP 调用都会把网络抖动放大成
--   "收货失败"。写成 outbox（与业务同事务）+ 独立投递任务，是 WMS 既有做法
--   （见 flow_webhook_outbox），保持一致。
--
-- 幂等：UNIQUE(event, biz_key) —— 同一批次重复扫描/重复投递只会有一次成功入队。
-- 重试：指数退避（30s 起，上限 30min），由 oa-outbox.service.ts 控制。
-- ============================================================

CREATE TABLE IF NOT EXISTS oa_event_outbox (
  id              BIGSERIAL PRIMARY KEY,
  event           VARCHAR(40) NOT NULL,          -- lot.created
  biz_key         VARCHAR(80) NOT NULL,          -- lot_no（幂等键）
  payload         JSONB NOT NULL,
  status          VARCHAR(12) NOT NULL DEFAULT 'pending',  -- pending | sent | failed
  attempts        INT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error      TEXT,
  sent_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event, biz_key)
);

CREATE INDEX IF NOT EXISTS idx_oa_outbox_due
  ON oa_event_outbox(next_attempt_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_oa_outbox_status
  ON oa_event_outbox(status, created_at DESC);

COMMENT ON TABLE oa_event_outbox IS 'WMS → OA 事件队列（待检推送等），outbox 模式';
