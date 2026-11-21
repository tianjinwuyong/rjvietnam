import { query, shutdown } from './services/_shared/db.js';

async function main() {
  // Create separate table for auto line FCT motherboard layouts
  await query(`
    CREATE TABLE IF NOT EXISTS station_confirmed_motherboard_layouts_auto (
      id BIGSERIAL PRIMARY KEY,
      motherboard_id VARCHAR(100),
      ict_batch_id VARCHAR(100),
      fct_batch_id VARCHAR(100),
      members JSONB NOT NULL DEFAULT '[]',
      status VARCHAR(50) DEFAULT 'ACTIVE',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  console.log('Created station_confirmed_motherboard_layouts_auto');

  // Create index
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_layouts_auto_mb ON station_confirmed_motherboard_layouts_auto(motherboard_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_layouts_auto_fct ON station_confirmed_motherboard_layouts_auto(fct_batch_id)`);

  // Add FK constraint if not exists
  await query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'layouts_auto_fct_fk'
      ) THEN
        ALTER TABLE station_confirmed_motherboard_layouts_auto 
        ADD CONSTRAINT layouts_auto_fct_fk 
        FOREIGN KEY (fct_batch_id) REFERENCES station_fct_batch_events(fct_batch_id) ON DELETE CASCADE;
      END IF;
    END $$
  `).catch(() => console.log('FK skipped (table may not exist)'));

  console.log('Done');
  await shutdown();
}

main().catch(e => { console.error(e); process.exit(1); });
