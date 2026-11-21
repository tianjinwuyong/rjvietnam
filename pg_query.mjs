import pg from "pg";
const { Client } = pg;

const client = new Client({
  host: "127.0.0.1",
  port: 5432,
  user: "postgres",
  password: "postgres",
  database: "postgres"
});

const dbs = await client.query("SELECT datname FROM pg_database WHERE datistemplate = false");
console.log("databases:", JSON.stringify(dbs.rows));

await client.connect();

const res = await client.query(
  "SELECT sn, station_code, result, error_code, repair_status FROM ng_defect_records WHERE sn LIKE $1 OR sn LIKE $2 ORDER BY id DESC LIMIT 5",
  ["TEST-NG%", "NG-TEST%"]
);
console.log("NG defect records:", JSON.stringify(res.rows, null, 2));

const pool = await client.query("SELECT sn, station_code, error_code, result FROM mes.ng_pool WHERE sn LIKE $1 OR sn LIKE $2 LIMIT 5", ["TEST-NG%", "NG-TEST%"]);
console.log("mes.ng_pool:", JSON.stringify(pool.rows, null, 2));

await client.end();
