import mssql from "mssql";

// SQL Server config — GM_WareHouse @ 192.168.0.110
const SQL_CONFIG = {
  server: "192.168.0.110",
  port: 1433,
  user: "sa",
  password: "abc@123",
  database: "GM_WareHouse",
  options: {
    encrypt: false,
    trustServerCertificate: true,
    enableArithAbort: true,
    authentication: "sql",
    connectionTimeout: 8000,  // fail fast — 8s max to establish connection
    requestTimeout: 30000,     // 30s per query
  },
  pool: { max: 3, min: 0, idleTimeoutMillis: 20000, connectionTimeout: 8000 },
};

let pool = null;
let connecting = false;
let connectErr = null;

// Graceful connect with timeout
async function tryConnect() {
  if (pool) return pool;
  if (connecting) {
    // Wait up to 10s for ongoing connection attempt
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 500));
      if (pool) return pool;
      if (connectErr) throw connectErr;
    }
    throw new Error("SQL Server connection in progress — timed out");
  }
  connecting = true;
  connectErr = null;
  try {
    pool = await mssql.connect(SQL_CONFIG);
    pool.on("error", (err) => {
      console.error("[GM_WareHouse SQL Pool error]", err.message);
      pool = null; // force reconnect on next query
    });
    console.log("[GM_WareHouse] SQL Server connected:", SQL_CONFIG.server);
    return pool;
  } catch (err) {
    connectErr = err;
    console.error("[GM_WareHouse] SQL Server connection failed:", err.message);
    pool = null;
    throw err;
  } finally {
    connecting = false;
  }
}

export async function getPool() {
  return tryConnect();
}

export async function sqlQuery(text, params = []) {
  try {
    const p = await tryConnect();
    const request = p.request();
    params.forEach((val, i) => request.input(`p${i + 1}`, val));
    const result = await request.query(text);
    return result.recordset;
  } catch (err) {
    // Never rethrow as unhandled — return empty set so API keeps running
    console.error("[GM_WareHouse sqlQuery error]", err.message);
    return [];   // callers treat [] as "no data" not "crash"
  }
}

export default { getPool, sqlQuery };
