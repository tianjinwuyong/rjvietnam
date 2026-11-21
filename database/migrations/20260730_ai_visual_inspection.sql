CREATE TABLE IF NOT EXISTS ai_visual_inspections (
  id bigserial PRIMARY KEY,
  inspection_no varchar(64) UNIQUE NOT NULL,
  station_code varchar(80) NOT NULL,
  line_code varchar(80),
  work_order_code varchar(160),
  sn varchar(200) NOT NULL,
  image_ref text,
  model_name varchar(160) NOT NULL,
  model_version varchar(80) NOT NULL,
  pass_score numeric(7,6) NOT NULL CHECK (pass_score BETWEEN 0 AND 1),
  defect_score numeric(7,6) NOT NULL CHECK (defect_score BETWEEN 0 AND 1),
  defect_code varchar(80),
  inference_latency_ms integer NOT NULL DEFAULT 0 CHECK (inference_latency_ms >= 0),
  proposed_result varchar(16) NOT NULL CHECK (proposed_result IN ('PASS','FAIL','REVIEW')),
  confidence numeric(7,6) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  reason_code varchar(64) NOT NULL,
  status varchar(24) NOT NULL CHECK (status IN ('AUTO_PASSED','PENDING_REVIEW','REVIEWED')),
  final_result varchar(16) CHECK (final_result IN ('PASS','FAIL')),
  reviewed_by varchar(120),
  review_comment text,
  reviewed_at timestamptz,
  created_by varchar(120),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_visual_inspections_status_created
  ON ai_visual_inspections(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_visual_inspections_sn
  ON ai_visual_inspections(sn, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_visual_inspection_audit (
  id bigserial PRIMARY KEY,
  inspection_id bigint NOT NULL REFERENCES ai_visual_inspections(id) ON DELETE CASCADE,
  action varchar(64) NOT NULL,
  actor varchar(120),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
