import mysql from "mysql2/promise";

// MySQL config — connect to local MySQL (root / root1234)
// Set env vars to override: MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE
const MYSQL_CONFIG = {
  host: process.env.MYSQL_HOST ?? "127.0.0.1",
  port: Number(process.env.MYSQL_PORT ?? 3306),
  user: process.env.MYSQL_USER ?? "root",
  password: process.env.MYSQL_PASSWORD ?? "root1234",
  database: process.env.MYSQL_DATABASE ?? "smt_factory",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
};

let pool = null;

function getPool() {
  if (!pool) {
    pool = mysql.createPool(MYSQL_CONFIG);
    console.log(`[MySQL] pool created for ${MYSQL_CONFIG.host}:${MYSQL_CONFIG.port}/${MYSQL_CONFIG.database}`);
  }
  return pool;
}

// Execute a query, returns array of rows
export async function mysqlQuery(text, params = []) {
  try {
    const p = getPool();
    const [rows] = await p.execute(text, params);
    return rows;
  } catch (err) {
    console.error("[MySQL query error]", err.message);
    return [];
  }
}

// Execute a query, returns first row or null
export async function mysqlGetOne(text, params = []) {
  const rows = await mysqlQuery(text, params);
  return rows[0] ?? null;
}

export default { getPool, mysqlQuery, mysqlGetOne };
