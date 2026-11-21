-- Add sequence_order to stations table for production-ordered queries
-- Backfill from station_sequences using station_code match

ALTER TABLE stations ADD COLUMN IF NOT EXISTS sequence_order smallint;

-- Backfill: join stations.code = station_sequences.station_code
-- When multiple line entries exist for same station (e.g. AOI-01 on AUTO-LINE and MANUAL-LINE),
-- take the minimum sequence_order per station code
UPDATE stations s
SET sequence_order = sub.min_seq
FROM (
  SELECT station_code, MIN(sequence_order) AS min_seq
  FROM station_sequences
  GROUP BY station_code
) sub
WHERE s.code = sub.station_code;

-- Set remaining stations without a sequence entry to NULL (will sort last)
-- (optional: set them to a large number to sort after sequenced stations)

CREATE INDEX IF NOT EXISTS idx_stations_sequence ON stations(line_id, sequence_order ASC NULLS LAST);
