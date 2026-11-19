-- 295: add the missing `alarmed_at` column to station_handover_transfers.
--
-- server.js's handover-timeout watcher runs
--   UPDATE station_handover_transfers SET alarmed_at=NOW() ...
-- but the live table was created before that column existed, so every tick
-- threw `字段 "alarmed_at" 不存在` and the repair-handover alarm never fired.
-- Same class of drift as qlt_repair_detail (migration 294).

ALTER TABLE station_handover_transfers
    ADD COLUMN IF NOT EXISTS alarmed_at timestamptz;

CREATE INDEX IF NOT EXISTS ix_station_handover_transfers_alarmed
    ON station_handover_transfers (alarmed_at)
    WHERE alarmed_at IS NOT NULL;
