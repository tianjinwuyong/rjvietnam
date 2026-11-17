-- M7: schema/index DDL belongs to migrations, never to the live event path.
CREATE INDEX IF NOT EXISTS idx_route_progress_root_seq
  ON station_sn_route_progress(root_sn,line_code,sequence_order);
CREATE INDEX IF NOT EXISTS idx_identity_alias_root
  ON station_sn_identity_alias(root_sn);
