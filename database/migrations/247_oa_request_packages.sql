ALTER TABLE oa_process_requests
  ADD COLUMN IF NOT EXISTS package_data jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN oa_process_requests.package_data IS
  'Immutable approval package snapshot: content, issuer, department, issue time and attachments';
