const { Pool } = require('pg');
const pool = new Pool({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'postgres', database: 'smt_factory' });
async function main() {
  await pool.query(`ALTER TABLE storage_locations
    ADD COLUMN IF NOT EXISTS x_coord numeric(12,3),
    ADD COLUMN IF NOT EXISTS y_coord numeric(12,3),
    ADD COLUMN IF NOT EXISTS coordinate_system varchar(32) DEFAULT 'WAREHOUSE_MAP',
    ADD COLUMN IF NOT EXISTS aisle_code varchar(64),
    ADD COLUMN IF NOT EXISTS rack_code varchar(64),
    ADD COLUMN IF NOT EXISTS level_code varchar(64),
    ADD COLUMN IF NOT EXISTS bin_code varchar(64),
    ADD COLUMN IF NOT EXISTS temperature_min numeric(8,2),
    ADD COLUMN IF NOT EXISTS temperature_max numeric(8,2),
    ADD COLUMN IF NOT EXISTS humidity_min numeric(8,2),
    ADD COLUMN IF NOT EXISTS humidity_max numeric(8,2),
    ADD COLUMN IF NOT EXISTS msd_allowed boolean DEFAULT true,
    ADD COLUMN IF NOT EXISTS max_pallets integer`);
  console.log('storage location coordinate and smart attributes ready');
  await pool.end();
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
