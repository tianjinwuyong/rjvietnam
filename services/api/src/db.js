import pg from "pg";
const { Pool } = pg;

let pool = null;

function getPool() {
  if (!pool) {
    const host = process.env.PGHOST;
    const password = process.env.PGPASSWORD;
    if (!host || host === "undefined" || host === "null" || host.trim() === "") {
      console.warn("[PostgreSQL] PGHOST not set or invalid");
      return null;
    }
    pool = new Pool({
      host: host,
      port: Number(process.env.PGPORT ?? 5432),
      user: process.env.PGUSER ?? "postgres",
      password: password,
      database: process.env.PGDATABASE ?? "smt_factory",
      // MES 3D snapshot polling can keep a connection busy while a large
      // JSON payload is being delivered. Keep enough headroom for the
      // interactive PDA/MES transaction endpoints instead of letting a few
      // dashboards exhaust the shared pool.
      max: Number(process.env.PGPOOL_MAX ?? 40),
      idleTimeoutMillis: 60000,
      connectionTimeoutMillis: 15000,
      ssl: String(process.env.PGSSL ?? "false").toLowerCase() === "true"
        ? { rejectUnauthorized: String(process.env.PGSSL_REJECT_UNAUTHORIZED ?? "true").toLowerCase() !== "false",
            ...(process.env.PGSSL_CA ? { ca: process.env.PGSSL_CA.replace(/\\n/g, "\n") } : {}) }
        : false,
    });
    pool.on("error", (err) => {
      console.error("[PostgreSQL] pool error:", err.message);
    });
    console.log(`[PostgreSQL] pool created for ${host}:${process.env.PGPORT ?? 5432}/${process.env.PGDATABASE ?? "smt_factory"}`);
  }
  return pool;
}

export async function query(sql, params) {
  const p = getPool();
  if (!p) throw new Error("PostgreSQL not configured (PGHOST not set)");
  const start = Date.now();
  const result = await p.query(sql, params);
  const duration = Date.now() - start;
  if (duration > 50) {
    console.warn(`[PostgreSQL] SLOW QUERY (${duration}ms):`, sql.substring(0, 160));
  }
  // Return compatible format: { rows, fields }
  return { rows: result.rows, fields: [] };
}

export async function getClient() {
  const p = getPool();
  if (!p) throw new Error("PostgreSQL not configured");
  return p.connect();
}

/** 参数读取（源 util.get_param；供 panel.js 等模块使用） */
export async function getParam(key, dflt = "") {
  const p = getPool();
  if (!p) return dflt;
  const r = await p.query("SELECT param_val FROM sys_param WHERE param_key=$1", [key]);
  return r.rows[0] && r.rows[0].param_val != null ? r.rows[0].param_val : dflt;
}

/** 参数写入（源 util.set_param） */
export async function setParam(key, val, name = "", group = "") {
  const p = getPool();
  if (!p) throw new Error("PostgreSQL not configured");
  const r = await p.query("SELECT id FROM sys_param WHERE param_key=$1", [key]);
  if (r.rows[0]) {
    await p.query(
      "UPDATE sys_param SET param_val=$1, param_name=COALESCE(NULLIF($2,''),param_name), group_name=COALESCE(NULLIF($3,''),group_name), updated_at=now() WHERE param_key=$4",
      [String(val), name, group, key]);
  } else {
    await p.query(
      "INSERT INTO sys_param (param_key, param_val, param_name, group_name, updated_at) VALUES ($1,$2,$3,$4,now())",
      [key, String(val), name || key, group || ""]);
  }
}

export default { query, getClient, getParam, setParam };
