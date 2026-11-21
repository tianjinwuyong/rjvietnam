-- 046_optional_station_id_for_work_start.sql
-- Allow station_id to be nullable in station_events partitions for WORK_START events (no physical station)

-- PostgreSQL requires the partitioned parent to be relaxed before its
-- partitions. Altering only children fails on a clean installation.
ALTER TABLE station_events ALTER COLUMN station_id DROP NOT NULL;
ALTER TABLE station_events_2026 ALTER COLUMN station_id DROP NOT NULL;
ALTER TABLE station_events_2027 ALTER COLUMN station_id DROP NOT NULL;
ALTER TABLE station_events_2028 ALTER COLUMN station_id DROP NOT NULL;
ALTER TABLE station_events_2029 ALTER COLUMN station_id DROP NOT NULL;
ALTER TABLE station_events_2030 ALTER COLUMN station_id DROP NOT NULL;
ALTER TABLE station_events_2031 ALTER COLUMN station_id DROP NOT NULL;
ALTER TABLE station_events_2032 ALTER COLUMN station_id DROP NOT NULL;
ALTER TABLE station_events_2033 ALTER COLUMN station_id DROP NOT NULL;
ALTER TABLE station_events_2034 ALTER COLUMN station_id DROP NOT NULL;
ALTER TABLE station_events_2035 ALTER COLUMN station_id DROP NOT NULL;
