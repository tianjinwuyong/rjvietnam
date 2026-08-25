/**
 * rda-query.js
 * Report Data Analysis — PostgreSQL queries for archival system.
 * Direct DB access (no API auth needed for scheduled tasks).
 *
 * Usage: node rda-query.js <scope> [options]
 *   scopes:
 *     archive-list       — list archives (--source, --category, --dateFrom, --dateTo)
 *     archive-detail     — get single archive (--id)
 *     categories         — list category tree with archive counts
 *     archive-snapshot   — archive a single report (--source, --rows, --params)
 *     retention-report   — show expirations in next N days (--days 30)
 *     register-analysis  — register an analysis view
 *     source-categories  — map source_key to category_id
 */

import pg from "pg";
const { Pool } = pg;

const pool = new Pool({
  host: process.env.PGHOST ?? "127.0.0.1",
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? "postgres",
  password: process.env.PGPASSWORD ?? "postgres",
  database: process.env.PGDATABASE ?? "smt_factory",
  max: 3,
});

// ── Args ─────────────────────────────────────────────────────
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i].startsWith("--")) {
    args[process.argv[i].slice(2)] = process.argv[i + 1] ?? null;
    i++;
  }
}
const scope = process.argv[2] ?? "categories";

// ── Helpers ──────────────────────────────────────────────────
async function query(sql, params = []) {
  const client = await pool.connect();
  try {
    const r = await client.query(sql, params);
    return r.rows;
  } finally {
    client.release();
  }
}

function parseJSON(val, fallback = null) {
  if (!val) return fallback;
  try { return JSON.parse(val); } catch { return fallback; }
}

// ── Category map (source_key → category_id) ─────────────────
const SOURCE_CATEGORY_MAP = {
  "work-order-progress":  { catCode: "prod-work-orders" },
  "oee-by-line":          { catCode: "prod-oee" },
  "defect-analysis":      { catCode: "prod-defect" },
  "aoi-yield":            { catCode: "qa-aoi" },
  "spi-yield":            { catCode: "qa-spi" },
  "oqc-summary":          { catCode: "qa-oqc" },
  "iqc-summary":          { catCode: "qa-iqc" },
  "delivery-risk":        { catCode: "qa-delivery-risk" },
  "inventory-ledger":     { catCode: "wh-inventory" },
  "material-movement":    { catCode: "wh-movement" },
  "material-balance":     { catCode: "wh-balance" },
  "attendance-summary":   { catCode: "hre-attendance" },
  "equipment-downtime":   { catCode: "hre-equipment" },
  "maintenance-summary":  { catCode: "hre-maintenance" },
  "ar-aging":             { catCode: "fin-ar" },
  "ap-aging":             { catCode: "fin-ap" },
};

// ── Scopes ───────────────────────────────────────────────────

async function sourceCategories() {
  // Resolve all source->category mappings
  const cats = await query("SELECT id, code FROM archive_categories");
  const catMap = Object.fromEntries(cats.map(c => [c.code, c.id]));
  const result = {};
  for (const [source, mapping] of Object.entries(SOURCE_CATEGORY_MAP)) {
    if (catMap[mapping.catCode]) {
      result[source] = { categoryId: catMap[mapping.catCode], categoryCode: mapping.catCode };
    }
  }
  console.log(JSON.stringify(result, null, 2));
}

async function categories() {
  // Full category tree with archive counts
  const rows = await query(`
    WITH archived AS (
      SELECT category_id, COUNT(*) AS cnt,
        MIN(archived_at) AS oldest, MAX(archived_at) AS newest
      FROM document_archives GROUP BY category_id
    )
    SELECT
      c.id, c.code, c.name_zh, c.name_en, c.name_vi,
      c.parent_id, c.sort_order, c.icon,
      COALESCE(a.cnt, 0) AS archive_count,
      a.oldest, a.newest
    FROM archive_categories c
    LEFT JOIN archived a ON a.category_id = c.id
    ORDER BY c.sort_order, c.id
  `);
  console.log(JSON.stringify(rows, null, 2));
}

async function archiveList() {
  const conds = [];
  const vals = [];
  let idx = 1;
  if (args.source) { conds.push(`a.source_key = $${idx++}`); vals.push(args.source); }
  if (args.category) { conds.push(`ac.code = $${idx++}`); vals.push(args.category); }
  if (args.dateFrom) { conds.push(`a.archived_at >= $${idx++}`); vals.push(args.dateFrom); }
  if (args.dateTo) { conds.push(`a.archived_at <= $${idx++}`); vals.push(args.dateTo); }
  const where = conds.length ? " WHERE " + conds.join(" AND ") : "";
  const limit = Math.min(Number(args.limit) || 50, 500);
  const offset = Number(args.offset) || 0;

  const sql = `
    SELECT a.id, a.archive_type, a.source_key, a.source_id,
      a.title_zh, a.title_en, a.title_vi,
      ac.code AS category_code, ac.name_zh AS category_name_zh,
      a.row_count, a.archived_by, a.archived_at, a.expires_at,
      a.is_pinned, a.checksum, a.user_agent,
      CASE WHEN a.expires_at < NOW() THEN 'expired' ELSE 'active' END AS retention_status
    FROM document_archives a
    JOIN archive_categories ac ON ac.id = a.category_id
    ${where}
    ORDER BY a.archived_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
  const rows = await query(sql, vals);
  console.log(JSON.stringify({ total: rows.length, rows }, null, 2));
}

async function archiveDetail() {
  if (!args.id) { console.error("--id required"); process.exit(1); }
  const rows = await query(`
    SELECT a.*, ac.code AS category_code, ac.name_zh AS category_name_zh,
      ac.parent_id,
      (SELECT code FROM archive_categories WHERE id = ac.parent_id) AS parent_category_code
    FROM document_archives a
    JOIN archive_categories ac ON ac.id = a.category_id
    WHERE a.id = $1
  `, [args.id]);
  if (!rows.length) { console.error("Not found"); process.exit(1); }
  console.log(JSON.stringify(rows[0], null, 2));
}

async function archiveSnapshot() {
  // Insert a single archive record.
  // Called by rda-manager.js or the API hook.
  if (!args.source) { console.error("--source required"); process.exit(1); }
  const mapping = SOURCE_CATEGORY_MAP[args.source];
  if (!mapping) { console.error(`Unknown source: ${args.source}`); process.exit(1); }

  const cats = await query("SELECT id FROM archive_categories WHERE code = $1", [mapping.catCode]);
  if (!cats.length) { console.error(`Category not found: ${mapping.catCode}`); process.exit(1); }
  const categoryId = cats[0].id;

  const rowsData = args.rows ? parseJSON(args.rows) : [];
  const paramsData = args.params ? parseJSON(args.params) : {};
  const userAgent = args.userAgent || "system:cli";
  const rowCount = Array.isArray(rowsData) ? rowsData.length : 0;

  const result = await query(`
    INSERT INTO document_archives
      (category_id, archive_type, source_key, source_id,
       title_zh, title_en, title_vi,
       snapshot_data, row_count, parameter_snapshot, user_agent)
    VALUES ($1, 'report', $2, $3,
            $4, $5, $6,
            $7::jsonb, $8, $9::jsonb, $10)
    RETURNING id, archived_at, checksum, expires_at
  `, [
    categoryId,
    args.source,
    args.sourceId || null,
    args.titleZh || null,
    args.titleEn || null,
    args.titleVi || null,
    JSON.stringify(rowsData),
    rowCount,
    JSON.stringify(paramsData),
    userAgent,
  ]);
  console.log(JSON.stringify(result[0], null, 2));
}

async function retentionReport() {
  const days = Number(args.days) || 30;
  const rows = await query(`
    SELECT
      ac.code AS category_code,
      COUNT(*) AS expiring_count,
      MAX(a.row_count) AS max_rows,
      MIN(a.expires_at) AS first_expiry
    FROM document_archives a
    JOIN archive_categories ac ON ac.id = a.category_id
    WHERE a.expires_at BETWEEN NOW() AND NOW() + INTERVAL '1 day' * $1
      AND NOT a.is_pinned
    GROUP BY ac.code
    ORDER BY COUNT(*) DESC
  `, [days]);
  const total = rows.reduce((s, r) => s + Number(r.expiring_count), 0);
  console.log(JSON.stringify({ expiringWithinDays: days, totalRecords: total, byCategory: rows }, null, 2));
}

async function registerAnalysis() {
  if (!args.code || !args.nameZh) {
    console.error("--code and --nameZh required");
    process.exit(1);
  }
  const catCode = args.category || null;
  let catId = null;
  if (catCode) {
    const cats = await query("SELECT id FROM archive_categories WHERE code = $1", [catCode]);
    if (cats.length) catId = cats[0].id;
  }
  const qDef = parseJSON(args.queryDef) || {};
  const pDef = parseJSON(args.paramDef) || [];

  const result = await query(`
    INSERT INTO archive_analysis_views
      (code, name_zh, name_en, name_vi, description_zh, description_en, description_vi,
       category_id, source_key, analysis_type, query_definition, parameter_definitions, is_public)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13)
    RETURNING id, code
  `, [
    args.code, args.nameZh, args.nameEn || args.nameZh, args.nameVi || args.nameZh,
    args.descZh || null, args.descEn || null, args.descVi || null,
    catId, args.sourceKey || null, args.analysisType || 'trend',
    JSON.stringify(qDef), JSON.stringify(pDef),
    args.isPublic !== 'false',
  ]);
  console.log(JSON.stringify(result[0], null, 2));
}

async function purgeExpiredArchives() {
  const dryRun = args.dryRun === 'true';
  if (dryRun) {
    const rows = await query("SELECT COUNT(*) AS cnt FROM document_archives WHERE expires_at < NOW() AND NOT is_pinned");
    console.log(JSON.stringify({ dryRun: true, wouldDelete: Number(rows[0].cnt) }));
    return;
  }
  const result = await query("DELETE FROM document_archives WHERE expires_at < NOW() AND NOT is_pinned RETURNING id");
  console.log(JSON.stringify({ deleted: result.length }));
}

// ── Main ─────────────────────────────────────────────────────
const handlers = {
  categories, "archive-list": archiveList, "archive-detail": archiveDetail,
  "archive-snapshot": archiveSnapshot, "retention-report": retentionReport,
  "register-analysis": registerAnalysis, "source-categories": sourceCategories,
  "purge-expired": purgeExpiredArchives,
};

if (handlers[scope]) {
  handlers[scope]().catch(e => { console.error(e.message); process.exit(1); });
} else {
  console.error(`Unknown scope: ${scope}`);
  console.error("Available: " + Object.keys(handlers).join(", "));
  process.exit(1);
}
