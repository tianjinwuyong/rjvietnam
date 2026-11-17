-- Trace indexes are migration-owned; the runtime service only reads/writes data.
CREATE INDEX IF NOT EXISTS idx_canonical_sn_trace_sn_time ON canonical_sn_trace_events(sn,occurred_at,event_id);
CREATE INDEX IF NOT EXISTS idx_canonical_sn_trace_root_time ON canonical_sn_trace_events(root_sn,occurred_at,event_id);
CREATE INDEX IF NOT EXISTS idx_canonical_sn_trace_station_time ON canonical_sn_trace_events(station_code,occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_canonical_sn_trace_correlation ON canonical_sn_trace_events(correlation_id);
CREATE INDEX IF NOT EXISTS idx_station_sn_registry_date ON station_sn_registry(station_code,production_date,sn);
CREATE INDEX IF NOT EXISTS idx_station_sn_registry_sn ON station_sn_registry(sn);
CREATE INDEX IF NOT EXISTS idx_factory_sn_master_date ON factory_sn_master(production_date,sn);
CREATE INDEX IF NOT EXISTS idx_factory_sn_master_status ON factory_sn_master(current_status,production_date);
