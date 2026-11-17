-- ============================================================
-- NG Defect Records & SN Duplicate Audit (10-year retention)
-- Partitioned tables: ng_defect_records, sn_duplicate_attempts
-- Note: public.repair_records already exists from an earlier migration
--       (links to quality_inspections); this migration does NOT re-create it.
-- ============================================================

-- Drop any leftover non-partitioned versions from previous partial runs
DROP TABLE IF EXISTS ng_defect_records CASCADE;
DROP TABLE IF EXISTS sn_duplicate_attempts CASCADE;

-- NG defect records — every NG event at any station
CREATE TABLE IF NOT EXISTS ng_defect_records (
  id                   bigserial,
  pcb_serial_id        bigint,
  work_order_id        bigint,
  station_id           bigint NOT NULL,
  defect_code_id       bigint NOT NULL REFERENCES defect_codes(id),
  defect_location      varchar(80),
  defect_description   text,
  defect_images        jsonb,
  result               varchar(20) NOT NULL DEFAULT 'ng',
  severity             varchar(20),
  disposition          varchar(20) NOT NULL DEFAULT 'pending',
    -- pending | repair | scrap | return | accept_as_is
  repair_record_id     bigint,
  operator_id          bigint,
  occurred_at          timestamptz NOT NULL DEFAULT now(),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE INDEX IF NOT EXISTS idx_ng_defect_pcb      ON ng_defect_records (pcb_serial_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ng_defect_wo       ON ng_defect_records (work_order_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ng_defect_station  ON ng_defect_records (station_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ng_defect_code     ON ng_defect_records (defect_code_id, occurred_at DESC);

-- sn_duplicate_attempts — audit log of every duplicate SN scan attempt
CREATE TABLE IF NOT EXISTS sn_duplicate_attempts (
  id                  bigserial,
  attempted_sn        varchar(120) NOT NULL,
  attempted_action   varchar(40) NOT NULL,
    -- scan_only | bind | issue_to_line | ship | rework
  station_id          bigint,
  line_id             bigint,
  work_order_id       bigint,
  operator_id         bigint,
  machine_id          bigint,
  existing_record_id  bigint,
  existing_sn         varchar(120),
  existing_status     varchar(40),
  decision            varchar(20) NOT NULL DEFAULT 'blocked',
    -- blocked | allowed | overridden
  override_user_id    bigint,
  override_reason     text,
  attempted_at        timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, attempted_at)
) PARTITION BY RANGE (attempted_at);

CREATE INDEX IF NOT EXISTS idx_sn_dup_sn       ON sn_duplicate_attempts (attempted_sn, attempted_at DESC);
CREATE INDEX IF NOT EXISTS idx_sn_dup_wo       ON sn_duplicate_attempts (work_order_id, attempted_at DESC);
CREATE INDEX IF NOT EXISTS idx_sn_dup_station  ON sn_duplicate_attempts (station_id, attempted_at DESC);
CREATE INDEX IF NOT EXISTS idx_sn_dup_decision ON sn_duplicate_attempts (decision, attempted_at DESC);

-- ============================================================
-- NG defect records partitions (2026-2035)
-- ============================================================
DO $$
DECLARE
  p TEXT;
BEGIN
  FOREACH p IN ARRAY ARRAY['ng_defect_records_2026','ng_defect_records_2027','ng_defect_records_2028',
    'ng_defect_records_2029','ng_defect_records_2030','ng_defect_records_2031',
    'ng_defect_records_2032','ng_defect_records_2033','ng_defect_records_2034','ng_defect_records_2035']
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = p) THEN
      EXECUTE format('CREATE TABLE ' || p || ' PARTITION OF ng_defect_records FOR VALUES FROM (%L) TO (%L)',
        split_part(p, '_', 4) || '-01-01',
        (split_part(p, '_', 4)::int + 1) || '-01-01');
    END IF;
  END LOOP;
END $$;

-- ============================================================
-- SN duplicate attempts partitions (2026-2035)
-- ============================================================
DO $$
DECLARE
  p TEXT;
BEGIN
  FOREACH p IN ARRAY ARRAY['sn_duplicate_attempts_2026','sn_duplicate_attempts_2027','sn_duplicate_attempts_2028',
    'sn_duplicate_attempts_2029','sn_duplicate_attempts_2030','sn_duplicate_attempts_2031',
    'sn_duplicate_attempts_2032','sn_duplicate_attempts_2033','sn_duplicate_attempts_2034','sn_duplicate_attempts_2035']
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = p) THEN
      EXECUTE format('CREATE TABLE ' || p || ' PARTITION OF sn_duplicate_attempts FOR VALUES FROM (%L) TO (%L)',
        split_part(p, '_', 4) || '-01-01',
        (split_part(p, '_', 4)::int + 1) || '-01-01');
    END IF;
  END LOOP;
END $$;
