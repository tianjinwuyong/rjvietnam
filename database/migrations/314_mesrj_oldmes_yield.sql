-- 314: 旧 MES 良率快照表（源 api/board.py /oldmes/push → prd_oldmes_yield）
-- 旧库是 SQLite 自带这张表；新库建过，但 mesrj 里的 /oldmes/push 只是吞异常的占位，
-- 表本身不存在，看板没有旧 MES 的良率窗口数据。这里补表并对齐列名。
CREATE TABLE IF NOT EXISTS prd_oldmes_yield (
  id              BIGSERIAL PRIMARY KEY,
  biz_date        TEXT NOT NULL DEFAULT '',
  time_from       TEXT NOT NULL DEFAULT '',
  time_to         TEXT NOT NULL DEFAULT '',
  group_code      TEXT NOT NULL DEFAULT '',
  group_name      TEXT NOT NULL DEFAULT '',
  product_step    TEXT NOT NULL DEFAULT '',
  flow_order      DOUBLE PRECISION NOT NULL DEFAULT 0,
  route_order     INTEGER NOT NULL DEFAULT 0,
  is_retest       INTEGER NOT NULL DEFAULT 0,
  failure_source  TEXT NOT NULL DEFAULT '',
  input_qty       INTEGER NOT NULL DEFAULT 0,
  failure1        INTEGER NOT NULL DEFAULT 0,
  failure2        INTEGER NOT NULL DEFAULT 0,
  true_fail       INTEGER NOT NULL DEFAULT 0,
  pass_qty        INTEGER NOT NULL DEFAULT 0,
  dppm            DOUBLE PRECISION NOT NULL DEFAULT 0,
  dppo            DOUBLE PRECISION,
  fpy             DOUBLE PRECISION NOT NULL DEFAULT 0,
  pass_yield      DOUBLE PRECISION NOT NULL DEFAULT 0,
  snapshot_at     TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_oldmes_yield_window
  ON prd_oldmes_yield (biz_date, time_from, time_to, group_code);

CREATE INDEX IF NOT EXISTS ix_oldmes_yield_date ON prd_oldmes_yield (biz_date);
