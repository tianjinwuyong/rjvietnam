CREATE TABLE IF NOT EXISTS employee_profile_update_requests (
  id bigserial PRIMARY KEY,
  employee_id bigint NOT NULL REFERENCES employees(id),
  request_type varchar(40) NOT NULL,
  proposed_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  photo_url text,
  status varchar(30) NOT NULL DEFAULT 'pending_hr',
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by bigint REFERENCES users(id),
  reviewed_at timestamptz,
  review_comment text,
  CONSTRAINT employee_profile_update_status_check
    CHECK (status IN ('pending_hr','approved','rejected'))
);

CREATE INDEX IF NOT EXISTS idx_employee_profile_updates_employee
  ON employee_profile_update_requests(employee_id, submitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_employee_profile_updates_status
  ON employee_profile_update_requests(status, submitted_at);
