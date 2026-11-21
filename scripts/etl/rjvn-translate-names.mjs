/**
 * Fill name_en / name_vi for imported rjvn master data using local Ollama.
 * Idempotent: only translates rows where name_en still equals name_zh (placeholder).
 * Resumable: progress committed per batch; interrupt/re-run is safe.
 *
 * Usage:
 *   node scripts/etl/rjvn-translate-names.mjs            # all pending
 *   node scripts/etl/rjvn-translate-names.mjs --test 5   # translate first N per table + write DB
 *   node scripts/etl/rjvn-translate-names.mjs            # all pending records
 */
import pg from "pg";
import { writeFileSync } from "node:fs";

const TEST = process.argv.includes("--test");
const TEST_N = Number(process.argv[process.argv.indexOf("--test") + 1]) || 5;
const BATCH = Number(process.env.TRANSLATE_BATCH) || 20;
const MODEL = "qwen2.5:1.5b";
const OLLAMA = "http://localhost:11434/api/generate";

const pool = new pg.Pool({
  host: process.env.PGHOST || "127.0.0.1",
  port: Number(process.env.PGPORT) || 5432,
  user: process.env.PGUSER || "smt_factory",
  database: process.env.PGDATABASE || "smt_factory",
  password: process.env.PGPASSWORD || undefined,
});

const TARGETS = [
  { table: "materials", idcol: "id" },
  { table: "suppliers", idcol: "id" },
  { table: "products", idcol: "id" },
];

function extractJson(text) {
  if (!text) return null;
  let s = String(text).trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const a = s.indexOf("["), b = s.lastIndexOf("]");
  if (a < 0 || b < 0) return null;
  try { return JSON.parse(s.slice(a, b + 1)); }
  catch { return null; }
}

async function translate(names) {
  // Line-delimited format avoids JSON escaping issues with Φ, *, quotes in
  // long packaging descriptions that broke JSON output.
  const input = names.map((n, i) => `${i + 1}| ${n}`).join("\n");
  const prompt =
    `For EACH numbered line, give BOTH an English translation AND a Vietnamese translation. ` +
    `Reply with EXACTLY ${names.length} lines. Each line MUST use a single vertical bar between fields, in this exact format:\n` +
    `1| English text | Vietnamese text\n` +
    `2| English text | Vietnamese text\n` +
    `Do NOT omit the Vietnamese part. No markdown, no explanation, keep each translation short.\n${input}`;
  const r = await fetch(OLLAMA, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, stream: false, prompt,
      options: { temperature: 0, num_predict: 4000 } }),
  });
  if (!r.ok) throw new Error(`Ollama HTTP ${r.status}`);
  const json = await r.json();
  const out = new Array(names.length).fill(null);
  for (const line of String(json.response || "").split("\n")) {
    const p = line.trim().split("|").map((s) => s.trim());
    if (p.length < 3) continue;
    const idx = Number(p[0]) - 1;
    if (idx >= 0 && idx < names.length && p[1] && p[2]) {
      out[idx] = { zh: names[idx], en: p[1], vi: p[2] };
    }
  }
  return out.some(Boolean) ? out : null;
}

let done = 0, failed = 0;
const report = [];
for (const { table, idcol } of TARGETS) {
  const { rows: placeholders } = await pool.query(
    `select ${idcol} as id, name_zh from public.${table}
     where name_en = name_zh order by ${idcol}`);
  // Filter in JS (SQL \u regex needs E'' and is fragile with non-ASCII via psql).
  const rows = placeholders.filter((r) => /[\u4e00-\u9fff]/.test(r.name_zh || ""));
  console.log(`[${table}] pending: ${rows.length}`);
  const todo = TEST ? rows.slice(0, TEST_N) : rows;
  for (let i = 0; i < todo.length; i += BATCH) {
    const chunk = todo.slice(i, i + BATCH);
    let result = null;
    // Retry once on transient bad shape / HTTP error (LLM output is nondeterministic).
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        result = await translate(chunk.map((r) => r.name_zh));
        if (Array.isArray(result)) break;
      } catch (e) { console.error(`  batch ${i} attempt ${attempt}: ${e.message}`); }
    }
    if (!Array.isArray(result)) {
      console.error(`  batch ${i}: bad shape after retry`);
      failed += chunk.length;
      continue;
    }
    // Match by original Chinese text (order may shift / model may drop items).
    const byZh = new Map(result.map((r) => [String(r?.zh || "").trim(), r]));
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (let k = 0; k < chunk.length; k++) {
        const hit = byZh.get(String(chunk[k].name_zh || "").trim()) || result[k];
        // All name_* columns are varchar(160); trim LLM output to fit.
        const en = String(hit?.en || "").trim().slice(0, 160);
        const vi = String(hit?.vi || "").trim().slice(0, 160);
        if (!en || !vi) { failed++; continue; }
        await client.query(
          `update public.${table} set name_en=$1, name_vi=$2 where ${idcol}=$3`,
          [en, vi, chunk[k].id]);
        done++;
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      console.error(`  batch ${i} DB error: ${e.message}`);
      failed += chunk.length;
    } finally { client.release(); }
    console.log(`  ${table}: ${Math.min(i + BATCH, todo.length)}/${todo.length} (ok=${done}, fail=${failed})`);
    if (TEST && i === 0) {
      report.push(...chunk.map((r) => {
        const hit = byZh.get(String(r.name_zh || "").trim());
        return { zh: r.name_zh, en: hit?.en, vi: hit?.vi };
      }));
    }
  }
}
await pool.end();
if (TEST) {
  writeFileSync("translations-test.json", JSON.stringify(report, null, 2), "utf8");
  console.log("Wrote translations-test.json");
}
console.log(`DONE ok=${done} failed=${failed}`);
