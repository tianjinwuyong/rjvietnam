import "dotenv/config";
import pg from "pg";

const pool = new pg.Pool({
  host: process.env.PGHOST ?? "127.0.0.1",
  port: Number(process.env.PGPORT ?? 5432),
  database: process.env.PGDATABASE ?? "smt_factory",
  user: process.env.PGUSER ?? "postgres",
  password: process.env.PGPASSWORD,
});
const client = await pool.connect();
try {
  await client.query("BEGIN");
  const products = (await client.query(
    `SELECT id,code FROM products
      WHERE UPPER(code) LIKE '%TEST%'
         OR name_zh LIKE '%测试%'
         OR LOWER(COALESCE(name_en,'')) LIKE '%test%'`,
  )).rows;
  const ids = products.map((item) => item.id);
  if (ids.length) {
    await client.query("DELETE FROM material_prices WHERE product_id=ANY($1::bigint[])", [ids]);
    await client.query("DELETE FROM products WHERE id=ANY($1::bigint[])", [ids]);
  }
  await client.query("COMMIT");
  console.log(JSON.stringify({ deleted: products.map((item) => item.code) }));
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
