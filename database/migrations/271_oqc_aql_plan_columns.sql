-- 271: AQL (Z1.4 / ISO 2859-1) fields on the existing OQC batch tables.
--
-- `qms_oqc_batches` already carried a single Ac/Re pair (ac_reject / re_pass) for
-- a flat "one defect class" inspection. Real出货抽检 judges three classes at
-- once — CR 致命 (Ac always 0), MA 主要, MI 轻微 — each with its own AQL and
-- acceptance number, and the sample size is the larger of the two plans.
--
-- Additive only: legacy columns keep working, old rows stay null on the new ones.

ALTER TABLE qms_oqc_batches
  ADD COLUMN IF NOT EXISTS aql_ma            NUMERIC(6,3),
  ADD COLUMN IF NOT EXISTS aql_mi            NUMERIC(6,3),
  ADD COLUMN IF NOT EXISTS sample_code       VARCHAR(8),
  ADD COLUMN IF NOT EXISTS lot_code          VARCHAR(8),
  ADD COLUMN IF NOT EXISTS inspection_level  VARCHAR(8) DEFAULT 'II',
  ADD COLUMN IF NOT EXISTS severity_profile  VARCHAR(16) DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS ac_critical       INTEGER,
  ADD COLUMN IF NOT EXISTS ac_major          INTEGER,
  ADD COLUMN IF NOT EXISTS re_major          INTEGER,
  ADD COLUMN IF NOT EXISTS ac_minor          INTEGER,
  ADD COLUMN IF NOT EXISTS re_minor          INTEGER,
  ADD COLUMN IF NOT EXISTS plan_source       VARCHAR(32),
  ADD COLUMN IF NOT EXISTS plan_note         TEXT,
  ADD COLUMN IF NOT EXISTS disposition       VARCHAR(24),
  ADD COLUMN IF NOT EXISTS disposition_reason TEXT,
  ADD COLUMN IF NOT EXISTS disposition_by    VARCHAR(120),
  ADD COLUMN IF NOT EXISTS disposition_at    TIMESTAMPTZ;

-- 判定时要按严重度统计不良数
CREATE INDEX IF NOT EXISTS idx_qms_oqc_items_batch_severity
  ON qms_oqc_items(batch_id, severity);

CREATE INDEX IF NOT EXISTS idx_qms_oqc_batches_status
  ON qms_oqc_batches(status, created_at DESC);

COMMENT ON COLUMN qms_oqc_batches.severity_profile IS 'normal 正常 / tightened 加严 / reduced 放宽';
COMMENT ON COLUMN qms_oqc_batches.sample_code IS 'Z1.4 样本代字（跳到相邻代字时与 lot_code 不同）';
COMMENT ON COLUMN qms_oqc_batches.disposition IS 'REWORK 返工 / WAIVER 特采 / SCRAP 报废';
