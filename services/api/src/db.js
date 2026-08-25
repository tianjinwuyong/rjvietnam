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

export default { query, getClient };
