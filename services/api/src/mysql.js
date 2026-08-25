import mysql from "mysql2/promise";

// MySQL config — user provided: root / root1234
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

export async function mysqlGetOne(text, params = []) {
  const rows = await mysqlQuery(text, params);
  return rows[0] ?? null;
}

// ── ps (production station) MySQL — 192.168.6.97 (MySQL 5.0, charset=utf8) ──

const PS_CONFIG = {
  host: process.env.PS_MYSQL_HOST ?? "192.168.6.97",
  port: Number(process.env.PS_MYSQL_PORT ?? 3306),
  user: process.env.PS_MYSQL_USER ?? "root",
  password: process.env.PS_MYSQL_PASSWORD ?? "8712234",
  database: process.env.PS_MYSQL_DB ?? "ps",
  charset: "utf8",
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 0,
};

let psPool = null;

function getPsPool() {
  if (!psPool) {
    psPool = mysql.createPool(PS_CONFIG);
    console.log(`[MySQL-PS] pool created for ${PS_CONFIG.host}:${PS_CONFIG.port}/${PS_CONFIG.database}`);
  }
  return psPool;
}

export async function psQuery(text, params = []) {
  try {
    const p = getPsPool();
    const [rows] = await p.execute(text, params);
    return rows;
  } catch (err) {
    console.error("[MySQL-PS query error]", err.message);
    return [];
  }
}

export async function psGetOne(text, params = []) {
  const rows = await psQuery(text, params);
  return rows[0] ?? null;
}

export default { getPool, mysqlQuery, mysqlGetOne, getPsPool, psQuery, psGetOne };
