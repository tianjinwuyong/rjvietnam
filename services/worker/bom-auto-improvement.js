/**
 * bom-auto-improvement.js — BOM 自动改善引擎
 *
 * Scans BOM/ECO history and production data, then recommends
 * cost reductions, component substitutions, process optimizations.
 *
 * Usage:
 *   node bom-auto-improvement.js run           (full recommendation run)
 *   node bom-auto-improvement.js suggest --bomid <id>
 *   node bom-auto-improvement.js cost-optimize --bomid <id>
 *   node bom-auto-improvement.js substitute    (find alternative materials)
 *   node bom-auto-improvement.js merge-suggestions  (consolidate eco items)
 */

import pg from "pg";
import { execSync } from "child_process";

const { Pool } = pg;
const pool = new Pool({
  host     : process.env.PGHOST     ?? "127.0.0.1",
  port     : Number(process.env.PGPORT ?? 5432),
  user     : process.env.PGUSER     ?? "postgres",
  password : process.env.PGPASSWORD ?? "postgres",
  database : process.env.PGDATABASE ?? "smt_factory",
  max      : 3,
});

// ── Ensure tables ────────────────────────────────────────────────────────
async function ensureTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS improvement_suggestions (
      id          bigserial PRIMARY KEY,
      bom_id      bigint NOT NULL,
      type        varchar(40) NOT NULL,        -- cost_reduce | substitute | process_opt | eco_merge
      title       varchar(200),
      description text,
      potential_saving numeric(12,2),
      confidence  int DEFAULT 50,
      status      varchar(20) DEFAULT 'pending', -- pending | applied | rejected
      created_at  timestamptz NOT NULL DEFAULT now()
    )
  `);
}

// ── Query helpers ───────────────────────────────────────────────────────
async function query(sql, params = []) {
  const r = await pool.query(sql, params);
  return r.rows;
}

// ── 1. Cost analysis per BOM ───────────────────────────────────────────
async function analyzeCost(bomId) {
  const lines = await query(`
    SELECT bl.id, bl.component_code, bl.qty_per, m.code AS mat_code,
           m.name_zh, m.unit_cost, (m.unit_cost * bl.qty_per) AS line_cost
    FROM bom_lines bl
    JOIN materials m ON m.id = bl.material_id
    WHERE bl.bom_id = $1
    ORDER BY line_cost DESC
  `, [bomId]);

  const totalCost = lines.reduce((s, l) => s + Number(l.line_cost), 0);
  // Top-cost items (> 15% of total)
  const highCost = lines.filter(l => l.line_cost > totalCost * 0.15);

  return { totalCost, lines, highCost };
}

// ── 2. Substitute suggestion — find similar cheaper materials ──────────
async function findSubstitutes(bomId) {
  const lines = await query(`
    SELECT bl.id, bl.material_id, m.code, m.name_zh, m.unit_cost, m.category
    FROM bom_lines bl
    JOIN materials m ON m.id = bl.material_id
    WHERE bl.bom_id = $1
  `, [bomId]);

  const suggestions = [];
  for (const line of lines) {
    if (!line.category) continue;
    // Find cheaper alternatives in same category
    const alts = await query(`
      SELECT code, name_zh, unit_cost
      FROM materials
      WHERE category = $1 AND unit_cost < $2 AND id != $3
      ORDER BY unit_cost
      LIMIT 2
    `, [line.category, line.unit_cost, line.material_id]);
    for (const alt of alts) {
      const saving = Number(line.unit_cost) - Number(alt.unit_cost);
      if (saving > 0) {
        suggestions.push({
          type: "substitute",
          title: `替换物料: ${line.code} → ${alt.code}`,
          description: `${line.name_zh}(${line.code}) 可替换为 ${alt.name_zh}(${alt.code}), 可节省 ¥${saving.toFixed(2)}/件`,
          potentialSaving: saving,
          confidence: 55,
        });
      }
    }
  }
  return suggestions;
}

// ── 3. Merge ECO suggestions — if many small pending ECOs, batch them ──
async function findEcoMergeOpportunities() {
  const pendingEcos = await query(`
    SELECT id, bom_id, type, created_at
    FROM eco
    WHERE status = 'pending'
    ORDER BY created_at
  `);

  const grouped = {};
  for (const eco of pendingEcos) {
    const key = `bom_${eco.bom_id}`;
    if (!grouped[key]) grouped[key] = { bomId: eco.bom_id, ecos: [] };
    grouped[key].ecos.push(eco);
  }

  return Object.values(grouped)
    .filter(g => g.ecos.length >= 3)
    .map(g => ({
      type: "eco_merge",
      title: `合并ECO: BOM ${g.bomId} 共${g.ecos.length}个待审批ECO可一次处理`,
      description: `BOM ID ${g.bomId} 有 ${g.ecos.length} 个待审批ECO (ID: ${g.ecos.map(e => e.id).join(", ")})，建议合并处理`,
      confidence: 70,
    }));
}

// ── 4. Process optimization ─────────────────────────────────────────────
async function findProcessOpts(bomId) {
  const lines = await query(`
    SELECT bl.*, wc.hourly_rate
    FROM bom_lines bl
    LEFT JOIN work_centers wc ON wc.id = bl.work_center_id
    WHERE bl.bom_id = $1 AND bl.work_center_id IS NOT NULL
  `, [bomId]);

  const opts = [];
  for (const line of lines) {
    if (line.estimated_time_min && line.estimated_time_min > 30) {
      opts.push({
        type: "process_opt",
        title: `工序优化: 第${line.operation_seq}工序时长${line.estimated_time_min}分钟`,
        description: `工序 ${line.operation_seq} 预计时间 ${line.estimated_time_min} 分钟，建议排查瓶颈工序`,
        confidence: 50,
      });
    }
  }
  return opts;
}

// ── Main recommendation ─────────────────────────────────────────────────
async function runRecommendations(bomId = null) {
  const suggestions = [];

  // Cost optimization (all BOMs or specific)
  if (bomId) {
    const cost = await analyzeCost(bomId);
    if (cost.highCost.length > 0) {
      suggestions.push({
        type: "cost_reduce",
        title: `BOM ${bomId} 成本优化`,
        description: `${cost.highCost.length} 项物料成本占比 > 15%，总成本 ¥${cost.totalCost.toFixed(2)}`,
        potentialSaving: cost.totalCost * 0.05,
        confidence: 60,
      });
    }

    const subs = await findSubstitutes(bomId);
    suggestions.push(...subs);

    const opts = await findProcessOpts(bomId);
    suggestions.push(...opts);
  }

  // ECO merge (global)
  const ecoMerges = await findEcoMergeOpportunities();
  suggestions.push(...ecoMerges);

  // Persist
  for (const s of suggestions) {
    await pool.query(
      `INSERT INTO improvement_suggestions
         (bom_id, type, title, description, potential_saving, confidence)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [bomId ?? 0, s.type, s.title, s.description, s.potentialSaving ?? 0, s.confidence]
    );
  }

  return suggestions;
}

// ── Suggest — one-shot for a BOM ────────────────────────────────────────
async function suggestBom(bomId) {
  return runRecommendations(bomId);
}

// ── CLI ──────────────────────────────────────────────────────────────────
async function main() {
  await ensureTables();

  const action = process.argv[2] ?? "run";

  try {
    let result;
    switch (action) {
      case "run":
        result = await runRecommendations(null);
        break;
      case "suggest": {
        const idx = process.argv.indexOf("--bomid");
        const bid = idx >= 0 ? Number(process.argv[idx + 1]) : null;
        result = await suggestBom(bid);
        break;
      }
      case "cost-optimize": {
        const idx = process.argv.indexOf("--bomid");
        const bid = idx >= 0 ? Number(process.argv[idx + 1]) : null;
        result = bid ? await analyzeCost(bid) : { error: "No bomid provided" };
        break;
      }
      case "substitute": {
        const idx = process.argv.indexOf("--bomid");
        const bid = idx >= 0 ? Number(process.argv[idx + 1]) : null;
        result = bid ? await findSubstitutes(bid) : await findSubstitutes(0);
        break;
      }
      case "merge-suggestions":
        result = await findEcoMergeOpportunities();
        break;
      default:
        console.error("Usage: bom-auto-improvement.js run|suggest|cost-optimize|substitute|merge-suggestions [--bomid <id>]");
        process.exit(1);
    }
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(JSON.stringify({ error: err.message }));
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
