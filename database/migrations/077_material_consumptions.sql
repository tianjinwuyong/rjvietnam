-- ============================================================
-- Migration 077: Material Consumptions Traceability
-- Records which material lot is consumed at which station for which SN
-- Purpose: Enables full genealogy — SN → material lots used at each station
-- ============================================================

CREATE TABLE IF NOT EXISTS material_consumptions (
  id                bigserial,
  pcb_serial_id     bigint NOT NULL REFERENCES pcb_serials(id),
  station_id        bigint NOT NULL REFERENCES stations(id),
  material_lot_id   bigint NOT NULL REFERENCES material_lots(id),
  work_order_id     bigint REFERENCES work_orders(id),
  quantity          numeric(18,6) NOT NULL DEFAULT 1,
  operator_id       bigint REFERENCES users(id),
  occurred_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

-- Indexes
CREATE INDEX idx_mc_pcb ON material_consumptions(pcb_serial_id, occurred_at DESC);
CREATE INDEX idx_mc_lot ON material_consumptions(material_lot_id, occurred_at DESC);
CREATE INDEX idx_mc_station ON material_consumptions(station_id, occurred_at DESC);
CREATE INDEX idx_mc_wo ON material_consumptions(work_order_id, occurred_at DESC);

-- 10-year partitions: 2026–2035
DO $$
DECLARE
  yr text;
  yr_start text;
  yr_end   text;
BEGIN
  FOREACH yr IN ARRAY ARRAY['2026','2027','2028','2029','2030',
                             '2031','2032','2033','2034','2035']
  LOOP
    yr_start := yr || '-01-01';
    yr_end   := (yr::int + 1) || '-01-01';
    IF NOT EXISTS (
      SELECT 1 FROM pg_tables WHERE tablename = 'material_consumptions_' || yr
    ) THEN
      EXECUTE format(
        'CREATE TABLE material_consumptions_%s PARTITION OF material_consumptions
         FOR VALUES FROM (%L) TO (%L)',
        yr, yr_start, yr_end
      );
    END IF;
  END LOOP;
END $$;

COMMENT ON TABLE material_consumptions IS 'Tracks which material lot is consumed at each station for each PCB SN — enables full genealogy traceability.';
