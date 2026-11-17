import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'postgres', database: 'smt_factory' });
const client = await pool.connect();
try {
  // Drop old table if exists
  await client.query(`DROP TABLE IF EXISTS alert_records CASCADE`);
  // Create solder_paste_alerts
  await client.query(`
    CREATE TABLE IF NOT EXISTS solder_paste_alerts (
      id BIGSERIAL PRIMARY KEY,
      alert_type VARCHAR(50) NOT NULL DEFAULT 'SOLDER_PASTE_QC',
      severity VARCHAR(20) DEFAULT 'warning',
      opening_id BIGINT REFERENCES solder_paste_openings(id) ON DELETE SET NULL,
      lot_id BIGINT REFERENCES solder_paste_lots(id) ON DELETE SET NULL,
      message TEXT,
      payload JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      acknowledged BOOLEAN DEFAULT FALSE,
      acknowledged_at TIMESTAMPTZ,
      acknowledged_by VARCHAR(100)
    )
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_solder_paste_alerts_type ON solder_paste_alerts(alert_type)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_solder_paste_alerts_created ON solder_paste_alerts(created_at DESC)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_solder_paste_alerts_openings ON solder_paste_alerts(opening_id)`);
  console.log('solder_paste_alerts table ready');
} finally { client.release(); await pool.end(); }
