CREATE TABLE IF NOT EXISTS system_test_cleanup_audit(
  cleanup_id bigserial PRIMARY KEY,
  cleanup_scope varchar(120) NOT NULL,
  actor varchar(120) NOT NULL,
  started_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  before_counts jsonb NOT NULL,
  deleted_counts jsonb NOT NULL,
  after_counts jsonb NOT NULL,
  result varchar(20) NOT NULL CHECK(result IN('PASS','FAIL')),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb
);
