-- Promotion gates are configurable tests and audits required for each employee growth level.

CREATE TABLE IF NOT EXISTS hr_promotion_level_gate_templates (
  id bigserial PRIMARY KEY,
  level smallint NOT NULL CHECK (level BETWEEN 1 AND 4),
  gate_code varchar(60) NOT NULL,
  gate_name varchar(160) NOT NULL,
  gate_type varchar(20) NOT NULL CHECK (gate_type IN ('test','audit')),
  required boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  UNIQUE(level, gate_code)
);

CREATE TABLE IF NOT EXISTS hr_promotion_appraisal_gates (
  id bigserial PRIMARY KEY,
  performance_review_id bigint NOT NULL REFERENCES performance_reviews(id) ON DELETE CASCADE,
  template_id bigint REFERENCES hr_promotion_level_gate_templates(id),
  level smallint NOT NULL CHECK (level BETWEEN 1 AND 4),
  gate_code varchar(60) NOT NULL,
  gate_name varchar(160) NOT NULL,
  gate_type varchar(20) NOT NULL CHECK (gate_type IN ('test','audit')),
  required boolean NOT NULL DEFAULT true,
  status varchar(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','passed','failed','waived')),
  evidence_note text,
  assessed_by bigint REFERENCES employees(id),
  assessed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(performance_review_id, gate_code)
);

INSERT INTO hr_promotion_level_gate_templates (level, gate_code, gate_name, gate_type, required, sort_order) VALUES
  (1, 'ATTENDANCE_REVIEW', 'Attendance review', 'audit', true, 10),
  (1, 'BASIC_SKILL_TEST', 'Basic skills test', 'test', true, 20),
  (2, 'SKILL_TEST', 'Role skills test', 'test', true, 10),
  (2, 'QUALITY_AUDIT', 'Quality and process audit', 'audit', true, 20),
  (3, 'ADVANCED_SKILL_TEST', 'Advanced skills test', 'test', true, 10),
  (3, 'LEADERSHIP_AUDIT', 'Teamwork and leadership audit', 'audit', true, 20),
  (3, 'QUALITY_AUDIT', 'Quality and process audit', 'audit', true, 30),
  (4, 'SENIOR_SKILL_TEST', 'Senior technical skills test', 'test', true, 10),
  (4, 'LEADERSHIP_PANEL', 'Leadership assessment panel', 'test', true, 20),
  (4, 'CROSS_FUNCTION_AUDIT', 'Cross-functional compliance audit', 'audit', true, 30),
  (4, 'HR_FINAL_AUDIT', 'HR promotion audit', 'audit', true, 40)
ON CONFLICT (level, gate_code) DO UPDATE SET
  gate_name = EXCLUDED.gate_name, gate_type = EXCLUDED.gate_type, required = EXCLUDED.required, sort_order = EXCLUDED.sort_order;

CREATE INDEX IF NOT EXISTS idx_promotion_gates_review ON hr_promotion_appraisal_gates(performance_review_id, status);
