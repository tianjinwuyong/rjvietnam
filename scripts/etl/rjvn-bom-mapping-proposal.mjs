/**
 * Read-only proposal: map material codes used by the imported rjvn draft BOMs
 * onto material codes used by the existing active BOMs, by name similarity.
 *
 * Output: docs/bom-mapping/proposal.csv — REVIEW ONLY. Nothing is written to DB.
 */
import pg from "pg";
import { writeFileSync, mkdirSync } from "node:fs";

const pool = new pg.Pool({
  host: process.env.PGHOST || "127.0.0.1", port: Number(process.env.PGPORT) || 5432,
  user: process.env.PGUSER || "postgres", password: process.env.PGPASSWORD || "postgres",
  database: process.env.PGDATABASE || "smt_factory",
});

const norm = (s) => String(s || "").toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
const han = (s) => String(s || "").replace(/[^\u4e00-\u9fff]/g, "");
const tokens = (s) => new Set(String(s || "").toLowerCase().match(/[a-z0-9]{6,}/g) || []);
function bigrams(s) {
  const out = new Set();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  if (s.length === 1) out.add(s);
  return out;
}
function dice(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = bigrams(a), B = bigrams(b);
  let shared = 0;
  for (const g of A) if (B.has(g)) shared++;
  return A.size + B.size ? (2 * shared) / (A.size + B.size) : 0;
}

async function materialsOf(status) {
  const { rows } = await pool.query(`
    select distinct m.id, m.code, m.name_zh, m.name_en, m.uom, rm.specification
    from public.boms b
    join public.bom_lines bl on bl.bom_id = b.id
    join public.materials m on m.id = bl.material_id
    left join public.rjvn_material rm on rm.material_code = m.code
    where b.status = $1 order by m.code`, [status]);
  return rows.map((r) => ({
    ...r,
    key: norm(`${r.name_zh || ""} ${r.specification || ""}`),
    hanKey: han(r.name_zh),
    toks: tokens(`${r.specification || ""} ${r.name_zh || ""}`),
  }));
}
const [draft, active] = await Promise.all([materialsOf("draft"), materialsOf("active")]);
console.log(`draft materials=${draft.length} active(legacy) materials=${active.length}`);

const rows = [];
for (const d of draft) {
  const ranked = active.map((a) => {
    const shared = [...d.toks].filter((tk) => a.toks.has(tk));
    // A shared manufacturer part number / spec token is strong evidence.
    const tokenScore = shared.length ? 0.9 + Math.min(shared.length, 3) * 0.03 : 0;
    return {
      a,
      shared,
      score: Math.max(tokenScore, dice(d.key, a.key), dice(d.hanKey, a.hanKey)),
    };
  }).sort((x, y) => y.score - x.score);
  const best = ranked[0] ?? { a: {}, score: 0, shared: [] };
  rows.push({
    rjvn_code: d.code,
    rjvn_name_zh: `${d.name_zh || ""} ${d.specification || ""}`.trim(),
    rjvn_name_en: d.name_en,
    uom: d.uom,
    legacy_code: best.a.code || "",
    legacy_name_zh: best.a.name_zh || "",
    score: best.score.toFixed(3),
    matched_tokens: best.shared.join(" "),
    alt1_code: ranked[1]?.a.code || "",
    alt1_score: ranked[1] ? ranked[1].score.toFixed(3) : "",
    decision: best.score >= 0.9 && best.shared.length ? "AUTO"
      : best.score >= 0.55 ? "REVIEW" : "NEW",
  });
}
await pool.end();

// A legacy code targeted by more than one rjvn code is ambiguous — never AUTO.
const autoTargets = new Map();
for (const r of rows) if (r.decision === "AUTO") {
  autoTargets.set(r.legacy_code, (autoTargets.get(r.legacy_code) || 0) + 1);
}
for (const r of rows) {
  if (r.decision === "AUTO" && autoTargets.get(r.legacy_code) > 1) r.decision = "CONFLICT";
}

const dir = "docs/bom-mapping";
mkdirSync(dir, { recursive: true });
const header = "rjvn_code,rjvn_name_zh,rjvn_name_en,uom,legacy_code,legacy_name_zh,score,matched_tokens,alt1_code,alt1_score,decision\n";
const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
writeFileSync(`${dir}/proposal.csv`, header + rows.map((r) =>
  [r.rjvn_code, r.rjvn_name_zh, r.rjvn_name_en, r.uom, r.legacy_code, r.legacy_name_zh,
   r.score, r.matched_tokens, r.alt1_code, r.alt1_score, r.decision].map(esc).join(",") + "\n").join(""), "utf8");
const counts = rows.reduce((m, r) => (m[r.decision] = (m[r.decision] || 0) + 1, m), {});
console.log("decisions:", JSON.stringify(counts));
console.log("wrote", `${dir}/proposal.csv`);
