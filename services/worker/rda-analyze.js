/**
 * rda-analyze.js
 * Report Data Analysis — Analysis engine for trend/comparison/cross-domain queries.
 * Operates on document_archives snapshot_data JSONB.
 *
 * Usage: node rda-analyze.js <command> [options]
 *   trend     — metric over time: --source <key> --metric <path> --period weekly
 *   compare   — compare groups:   --source <key> --metric <col> --groups <a,b>
 *   aggregate — period agg:       --source <key> --metric <col> --agg sum --period monthly
 *   drill     — drill-down:       --source <key> --dimension <col> --metric <col>
 *   cross     — cross-domain:     --x <source> --y <source> --metricX <col> --metricY <col>
 *   integrity — checksum verify:  --sample 5
 *   missing   — detect gaps:      --source <key> --expectedInterval daily
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

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i].startsWith("--")) {
    args[process.argv[i].slice(2)] = process.argv[i + 1] ?? null;
    i++;
  }
}
const command = process.argv[2] ?? "trend";

async function query(sql, params = []) {
  const client = await pool.connect();
  try { const r = await client.query(sql, params); return r.rows; }
  finally { client.release(); }
}

// ── Extract metric from snapshot_data JSON by path ───────────
// Path like "rows[0].oee" navigates into the JSON array.
function extractMetricValue(rows, metricPath) {
  // Simple path: "oee" or "defect_count"
  if (!metricPath || !Array.isArray(rows)) return null;
  if (rows.length === 0) return null;

  const parts = metricPath.split(".");
  if (parts.length === 1) {
    // Aggregate: sum/average all row values for this column
    const vals = rows.map(r => Number(r[metricPath])).filter(v => !isNaN(v));
    if (vals.length === 0) return null;
    return { sum: vals.reduce((a, b) => a + b, 0), avg: vals.reduce((a, b) => a + b, 0) / vals.length, count: vals.length, samples: vals };
  }
  return null;
}

function extractDimensionValues(rows, dimensionCol, metricCol) {
  if (!Array.isArray(rows)) return [];
  const groups = {};
  for (const row of rows) {
    const dim = row[dimensionCol];
    const val = Number(row[metricCol]);
    if (dim === undefined || dim === null || isNaN(val)) continue;
    if (!groups[dim]) groups[dim] = { sum: 0, count: 0, vals: [] };
    groups[dim].sum += val;
    groups[dim].count++;
    groups[dim].vals.push(val);
  }
  return Object.entries(groups).map(([dim, data]) => ({
    dimension: dim,
    total: data.sum,
    avg: data.sum / data.count,
    count: data.count,
  }));
}

// ── Trend: metric over time ──────────────────────────────────
async function trend() {
  const src = args.source;
  const metric = args.metric;
  const period = args.period || "weekly";
  if (!src || !metric) { console.error("--source and --metric required"); process.exit(1); }

  const grpExpr = period === "monthly"
    ? "DATE_TRUNC('month', archived_at)::date"
    : period === "daily"
      ? "DATE_TRUNC('day', archived_at)::date"
      : "DATE_TRUNC('week', archived_at)::date";

  const dateFrom = args.dateFrom || "1970-01-01";
  const dateTo = args.dateTo || "2100-01-01";

  const rows = await query(`
    SELECT id, archived_at, ${grpExpr} AS period_start, snapshot_data, row_count, parameter_snapshot
    FROM document_archives
    WHERE source_key = $1 AND archived_at >= $2 AND archived_at <= $3
    ORDER BY archived_at ASC
  `, [src, dateFrom, dateTo]);

  if (!rows.length) { console.log(JSON.stringify({ source: src, metric, period, dataPoints: [] })); return; }

  // Group by period and extract metric
  const periodMap = {};
  for (const row of rows) {
    const key = row.period_start;
    if (!periodMap[key]) periodMap[key] = [];
    periodMap[key].push(row);
  }

  const series = [];
  for (const [periodStart, archives] of Object.entries(periodMap)) {
    // Use latest archive in each period
    const latest = archives.reduce((a, b) => a.archived_at > b.archived_at ? a : b);
    const sd = typeof latest.snapshot_data === 'string' ? JSON.parse(latest.snapshot_data) : latest.snapshot_data;
    const extracted = extractMetricValue(sd?.rows || sd, metric);
    if (extracted) {
      series.push({
        period: periodStart,
        value: extracted.avg,
        sum: extracted.sum,
        count: extracted.count,
        archiveId: latest.id,
        archiveCountInPeriod: archives.length,
      });
    }
  }

  // Stats
  const values = series.map(s => s.value).filter(v => v !== null && v !== undefined);
  const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  const stddev = values.length > 1
    ? Math.sqrt(values.reduce((sum, v) => sum + (v - avg) ** 2, 0) / values.length)
    : 0;

  // Anomaly detection
  const anomalies = values.length > 2 ? series.filter(s => Math.abs(s.value - avg) > 2 * stddev).map(s => ({
    period: s.period, value: s.value, expected: avg, deviation: s.value - avg, severity: Math.abs(s.value - avg) > 3 * stddev ? "critical" : "warning"
  })) : [];

  console.log(JSON.stringify({
    source: src, metric, period, dataPoints: series.length,
    stats: { avg: Math.round(avg * 100) / 100, stddev: Math.round(stddev * 100) / 100, min: Math.min(...values), max: Math.max(...values) },
    anomalies,
    series,
  }, null, 2));
}

// ── Compare: metric across groups ────────────────────────────
async function compare() {
  const src = args.source;
  const metric = args.metric;
  const groups = args.groups ? args.groups.split(",") : [];
  if (!src || !metric || !groups.length) { console.error("--source, --metric, --groups required"); process.exit(1); }

  const rows = await query(`
    SELECT id, archived_at, snapshot_data, row_count
    FROM document_archives
    WHERE source_key = $1 ORDER BY archived_at DESC LIMIT 20
  `, [src]);

  if (!rows.length) { console.log(JSON.stringify({ source: src, metric, groups, comparisons: [] })); return; }

  const latest = rows[0];
  const sd = typeof latest.snapshot_data === 'string' ? JSON.parse(latest.snapshot_data) : latest.snapshot_data;
  const dataRows = sd?.rows || sd || [];

  const result = {};
  for (const grp of groups) {
    result[grp] = extractDimensionValues(dataRows, grp, metric);
  }

  console.log(JSON.stringify({
    source: src, metric, groups,
    archiveId: latest.id, archivedAt: latest.archived_at,
    comparisons: result,
  }, null, 2));
}

// ── Aggregate: period aggregation ────────────────────────────
async function aggregate() {
  const src = args.source;
  const metric = args.metric;
  const agg = args.agg || "sum";
  const period = args.period || "monthly";

  if (!src || !metric) { console.error("--source and --metric required"); process.exit(1); }

  const grpExpr = period === "monthly"
    ? "DATE_TRUNC('month', archived_at)::date"
    : period === "weekly"
      ? "DATE_TRUNC('week', archived_at)::date"
      : "DATE_TRUNC('day', archived_at)::date";

  const rows = await query(`
    SELECT id, archived_at, ${grpExpr} AS period_start, snapshot_data, row_count
    FROM document_archives
    WHERE source_key = $1
    ORDER BY archived_at ASC
  `, [src]);

  const periodMap = {};
  for (const row of rows) {
    const key = row.period_start;
    if (!periodMap[key]) periodMap[key] = [];
    periodMap[key].push(row);
  }

  const aggregated = [];
  for (const [periodStart, archives] of Object.entries(periodMap)) {
    const latest = archives.reduce((a, b) => a.archived_at > b.archived_at ? a : b);
    const sd = typeof latest.snapshot_data === 'string' ? JSON.parse(latest.snapshot_data) : latest.snapshot_data;
    const extracted = extractMetricValue(sd?.rows || sd, metric);
    if (extracted) {
      aggregated.push({
        period: periodStart,
        [agg]: agg === "sum" ? extracted.sum : agg === "count" ? extracted.count : extracted.avg,
        totalSamples: extracted.count,
        archiveCount: archives.length,
      });
    }
  }

  console.log(JSON.stringify({ source: src, metric, agg, period, dataPoints: aggregated.length, aggregated }, null, 2));
}

// ── Drill-down ───────────────────────────────────────────────
async function drill() {
  const src = args.source;
  const dim = args.dimension;
  const metric = args.metric;
  const agg = args.agg || "count";
  if (!src || !dim) { console.error("--source and --dimension required"); process.exit(1); }

  const rows = await query(`
    SELECT id, archived_at, snapshot_data
    FROM document_archives
    WHERE source_key = $1 ORDER BY archived_at DESC LIMIT 10
  `, [src]);

  if (!rows.length) { console.log(JSON.stringify({ source: src, drill: [] })); return; }
  const latest = rows[0];
  const sd = typeof latest.snapshot_data === 'string' ? JSON.parse(latest.snapshot_data) : latest.snapshot_data;
  const dataRows = sd?.rows || sd || [];

  const groups = extractDimensionValues(dataRows, dim, metric || dim);
  console.log(JSON.stringify({
    source: src, dimension: dim, metric: metric || dim, agg,
    archiveId: latest.id, archivedAt: latest.archived_at,
    drillDown: groups,
  }, null, 2));
}

// ── Cross-domain ─────────────────────────────────────────────
async function cross() {
  const x = args.x;
  const y = args.y;
  const metricX = args.metricX;
  const metricY = args.metricY;
  const period = args.period || "weekly";
  if (!x || !y) { console.error("--x and --y required"); process.exit(1); }

  const grpExpr = period === "monthly"
    ? "DATE_TRUNC('month', archived_at)::date"
    : "DATE_TRUNC('week', archived_at)::date";

  const dateFrom = args.dateFrom || "1970-01-01";
  const dateTo = args.dateTo || "2100-01-01";

  const xRows = await query(`
    SELECT archived_at, ${grpExpr} AS period_start, snapshot_data
    FROM document_archives WHERE source_key = $1
    AND archived_at >= $2 AND archived_at <= $3 ORDER BY archived_at ASC
  `, [x, dateFrom, dateTo]);

  const yRows = await query(`
    SELECT archived_at, ${grpExpr} AS period_start, snapshot_data
    FROM document_archives WHERE source_key = $1
    AND archived_at >= $2 AND archived_at <= $3 ORDER BY archived_at ASC
  `, [y, dateFrom, dateTo]);

  // Build period-indexed maps
  const xMap = {}, yMap = {};
  for (const row of xRows) {
    const sd = typeof row.snapshot_data === 'string' ? JSON.parse(row.snapshot_data) : row.snapshot_data;
    const val = extractMetricValue(sd?.rows || sd, metricX || "row_count");
    if (val) xMap[row.period_start] = val.avg;
  }
  for (const row of yRows) {
    const sd = typeof row.snapshot_data === 'string' ? JSON.parse(row.snapshot_data) : row.snapshot_data;
    const val = extractMetricValue(sd?.rows || sd, metricY || "row_count");
    if (val) yMap[row.period_start] = val.avg;
  }

  // Aligned periods
  const allPeriods = [...new Set([...Object.keys(xMap), ...Object.keys(yMap)])].sort();
  const aligned = allPeriods.map(p => ({
    period: p,
    [x]: xMap[p] ?? null,
    [y]: yMap[p] ?? null,
  }));

  // Simple correlation
  const paired = aligned.filter(a => a[x] !== null && a[y] !== null);
  const n = paired.length;
  let correlation = null;
  if (n >= 3) {
    const meanX = paired.reduce((s, p) => s + p[x], 0) / n;
    const meanY = paired.reduce((s, p) => s + p[y], 0) / n;
    const num = paired.reduce((s, p) => s + (p[x] - meanX) * (p[y] - meanY), 0);
    const denX = Math.sqrt(paired.reduce((s, p) => s + (p[x] - meanX) ** 2, 0));
    const denY = Math.sqrt(paired.reduce((s, p) => s + (p[y] - meanY) ** 2, 0));
    correlation = denX && denY ? num / (denX * denY) : 0;
  }

  console.log(JSON.stringify({
    x: { source: x, metric: metricX || "row_count" },
    y: { source: y, metric: metricY || "row_count" },
    period, dataPoints: n,
    correlation: correlation ? Math.round(correlation * 1000) / 1000 : null,
    correlationStrength: correlation === null ? "insufficient_data"
      : Math.abs(correlation) > 0.7 ? "strong" : Math.abs(correlation) > 0.4 ? "moderate" : "weak",
    series: aligned,
  }, null, 2));
}

// ── Integrity check ──────────────────────────────────────────
async function integrity() {
  const sample = Math.min(Number(args.sample) || 5, 100);
  const rows = await query(`
    SELECT id, checksum, snapshot_data::text AS data_text
    FROM document_archives TABLESAMPLE BERNOULLI($1)
    WHERE checksum IS NOT NULL
    LIMIT 200
  `, [sample]);

  const { createHash } = await import("node:crypto");
  let passed = 0, failed = 0;
  const failures = [];
  for (const row of rows) {
    const expected = row.checksum;
    const actual = createHash("sha256").update(row.data_text).digest("hex");
    if (expected === actual) {
      passed++;
    } else {
      failed++;
      failures.push({ id: row.id, expected, actual });
    }
  }

  console.log(JSON.stringify({
    sample,
    totalChecked: rows.length,
    passed, failed,
    failures: failures.length > 0 ? failures : undefined,
    healthy: failed === 0,
  }, null, 2));
}

// ── Missing data detection ───────────────────────────────────
async function missing() {
  const src = args.source;
  const interval = args.expectedInterval || "daily";
  if (!src) { console.error("--source required"); process.exit(1); }

  const rows = await query(`
    SELECT DATE_TRUNC('day', archived_at)::date AS day, COUNT(*) AS cnt
    FROM document_archives
    WHERE source_key = $1
    GROUP BY 1 ORDER BY 1
  `, [src]);

  if (!rows.length) {
    console.log(JSON.stringify({ source: src, status: "no_data", gaps: [] }));
    return;
  }

  const expectedDays = interval === "daily" ? 1 : interval === "weekly" ? 7 : 30;
  const gaps = [];
  for (let i = 1; i < rows.length; i++) {
    const diff = (new Date(rows[i].day) - new Date(rows[i - 1].day)) / (1000 * 60 * 60 * 24);
    if (diff > expectedDays * 2) {
      gaps.push({
        from: rows[i - 1].day,
        to: rows[i].day,
        missingDays: Math.round(diff - expectedDays),
      });
    }
  }

  console.log(JSON.stringify({
    source: src,
    expectedInterval: interval,
    totalArchives: rows.length,
    dateRange: { from: rows[0].day, to: rows[rows.length - 1].day },
    gaps,
    hasGaps: gaps.length > 0,
  }, null, 2));
}

// ── Main ─────────────────────────────────────────────────────
const handlers = { trend, compare, aggregate, drill, cross, integrity, missing };
if (handlers[command]) {
  handlers[command]().catch(e => { console.error(e.message); process.exit(1); });
} else {
  console.error(`Unknown command: ${command}`);
  console.error("Available: " + Object.keys(handlers).join(", "));
  process.exit(1);
}
