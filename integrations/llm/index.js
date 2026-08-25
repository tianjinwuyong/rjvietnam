import { query } from "../../services/api/src/db.js";

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const DEFAULT_MODEL = process.env.OLLAMA_MODEL ?? "gemma4:latest";
const TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS ?? 60_000);

async function ollamaChat(model, messages, opts = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${OLLAMA_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, stream: false, ...opts }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Ollama ${res.status}: ${err}`);
    }
    const json = await res.json();
    return json.choices?.[0]?.message ?? { role: "assistant", content: "" };
  } finally {
    clearTimeout(timeout);
  }
}

export async function askChat(prompt, opts = {}) {
  const locale = opts?.locale ?? "zh-CN";
  const model = opts?.model ?? DEFAULT_MODEL;

  // System prompt for factory assistant
  const systemPrompt = locale === "vi-VN"
    ? "Bạn là trợ lý AI cho nhà máy Ruijing Việt Nam. Trả lời bằng tiếng Việt."
    : locale === "en-US"
    ? "You are the AI assistant for Vietnam Ruijing factory. Reply in English."
    : "你是越南瑞晶工厂的AI助手。请用中文回复。";

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: prompt },
  ];

  try {
    return await ollamaChat(model, messages);
  } catch (err) {
    console.error("[llm/askChat]", err.message);
    return { role: "assistant", content: `[AI暂时不可用: ${err.message}]` };
  }
}

export async function askServiceAgent(prompt, opts = {}) {
  return askChat(prompt, opts);
}

const _invI18n = (zh, en) => zh ? zh : en;
const _invNum = (n) => Number(n ?? 0).toLocaleString("en-US");

/**
 * Real rule-based WMS inventory query engine (no LLM required).
 * Classifies the prompt into an intent, runs live SQL against the WMS tables,
 * and returns a readable answer + the executed SQL (transparency).
 */
export async function askInventoryQuery(prompt = "", lots = [], opts = {}) {
  const locale = opts?.locale ?? "zh-CN";
  const zh = locale === "zh-CN" || (locale !== "en-US" && locale !== "vi-VN");
  const q = String(prompt || "").toLowerCase();
  const nameOf = (r) => (zh ? r.nameZh ?? r.nameEn : r.nameEn ?? r.nameZh);

  const fallback = (errMsg) => {
    if (!lots?.length) {
      return { sql: "", explanation: zh ? `[查询失败: ${errMsg}]` : `[Query failed: ${errMsg}]` };
    }
    const total = lots.reduce((s, l) => s + Number(l.qty ?? 0), 0);
    const counts = {};
    for (const l of lots) {
      const k = l.iqcStatus ?? "unknown";
      counts[k] = (counts[k] ?? 0) + 1;
    }
    const statusLine = Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(", ");
    return {
      sql: "",
      explanation: zh
        ? `[实时快照 ${lots.length} 批 · 合计 ${_invNum(total)}]\n${statusLine}`
        : `[Live snapshot ${lots.length} lots · total ${_invNum(total)}]\n${statusLine}`,
    };
  };

  try {
    // ── 1) Low stock / shortage ──────────────────────────────────────────────
    if (/(库存不足|缺料|欠料|不足|shortage|low\s*stock)/i.test(q)) {
      const sql = `SELECT m.code AS "materialCode",
          COALESCE(m.name_zh, m.name_en) AS "nameZh",
          COALESCE(m.name_en, m.name_zh) AS "nameEn",
          COALESCE(SUM(ml.received_qty - COALESCE(ml.reserved_qty, 0)), 0) AS "availableQty",
          COUNT(*) AS "lotCount", COALESCE(m.uom, '') AS "uom",
          COALESCE(m.safety_stock_qty, 0) AS "safetyStock"
        FROM material_lots ml
        JOIN materials m ON m.id = ml.material_id
        WHERE ml.lot_status = 'open'
        GROUP BY m.code, m.name_zh, m.name_en, m.uom, m.safety_stock_qty
        ORDER BY "availableQty" ASC, m.code ASC
        LIMIT 10`;
      const { rows } = await query(sql);
      if (!rows.length) return { sql, explanation: zh ? "[暂无库存数据]" : "[No inventory data]" };
      const lines = rows.map((r, i) => {
        const flag = r.availableQty <= r.safetyStock ? " ⚠️低于安全库存" : "";
        return `${i + 1}. ${r.materialCode} ${nameOf(r)} — 可用 ${_invNum(r.availableQty)} ${r.uom}（${r.lotCount} 批）${flag}`;
      });
      const title = zh ? "📦 库存最少的物料（可用数量升序）" : "📦 Materials with lowest stock (ascending)";
      return { sql, explanation: `${title}\n${lines.join("\n")}` };
    }

    // ── 2) IQC pending / hold ────────────────────────────────────────────────
    if (/(iqc|待检|检验|来料|hold|pending|inspection)/i.test(q)) {
      const sql = `SELECT m.code AS "materialCode",
          COALESCE(m.name_zh, m.name_en) AS "nameZh",
          COALESCE(m.name_en, m.name_zh) AS "nameEn",
          ml.lot_no AS "lotNo",
          ml.received_qty - COALESCE(ml.reserved_qty, 0) AS "qty",
          ml.iqc_status AS "iqcStatus", sl.code AS "locationCode"
        FROM material_lots ml
        JOIN materials m ON m.id = ml.material_id
        LEFT JOIN storage_locations sl ON sl.id = ml.storage_location_id
        WHERE ml.lot_status = 'open' AND ml.iqc_status IN ('hold','pending')
        ORDER BY ml.iqc_status, m.code
        LIMIT 20`;
      const { rows } = await query(sql);
      if (!rows.length) return { sql, explanation: zh ? "✅ 当前没有待检/HOLD 的批次" : "✅ No lots pending IQC / HOLD" };
      const lines = rows.map((r, i) => `${i + 1}. ${r.materialCode} ${nameOf(r)} 批次 ${r.lotNo} — ${r.iqcStatus.toUpperCase()}（${_invNum(r.qty)}${r.locationCode ? " · " + r.locationCode : ""}）`);
      const title = zh ? `🔍 IQC 待检/HOLD 批次（${rows.length}）` : `🔍 IQC pending/HOLD lots (${rows.length})`;
      return { sql, explanation: `${title}\n${lines.join("\n")}` };
    }

    // ── 3) Rejected / defective ──────────────────────────────────────────────
    if (/(reject|不合格|退货|退料)/i.test(q)) {
      const sql = `SELECT m.code AS "materialCode",
          COALESCE(m.name_zh, m.name_en) AS "nameZh",
          COALESCE(m.name_en, m.name_zh) AS "nameEn",
          ml.lot_no AS "lotNo", ml.received_qty - COALESCE(ml.reserved_qty, 0) AS "qty"
        FROM material_lots ml
        JOIN materials m ON m.id = ml.material_id
        WHERE ml.lot_status = 'open' AND ml.iqc_status = 'rejected'
        ORDER BY m.code
        LIMIT 20`;
      const { rows } = await query(sql);
      if (!rows.length) return { sql, explanation: zh ? "✅ 当前没有不合格/退货批次" : "✅ No rejected lots" };
      const lines = rows.map((r, i) => `${i + 1}. ${r.materialCode} ${nameOf(r)} 批次 ${r.lotNo} — ${_invNum(r.qty)}`);
      const title = zh ? `⛔ 不合格/退货批次（${rows.length}）` : `⛔ Rejected lots (${rows.length})`;
      return { sql, explanation: `${title}\n${lines.join("\n")}` };
    }

    // ── 4) Expiry / shelf life ───────────────────────────────────────────────
    if (/(过期|效期|临期|expir|shelf\s*life)/i.test(q)) {
      const sql = `SELECT m.code AS "materialCode",
          COALESCE(m.name_zh, m.name_en) AS "nameZh",
          COALESCE(m.name_en, m.name_zh) AS "nameEn",
          ml.lot_no AS "lotNo", ml.expiry_date AS "expiryDate",
          ml.lifecycle_status AS "lifecycleStatus",
          ml.received_qty - COALESCE(ml.reserved_qty, 0) AS "qty"
        FROM material_lots ml
        JOIN materials m ON m.id = ml.material_id
        WHERE ml.lot_status = 'open'
          AND (ml.expiry_date IS NOT NULL AND ml.expiry_date <= CURRENT_DATE + INTERVAL '90 days'
               OR ml.lifecycle_status IS NOT NULL AND ml.lifecycle_status <> 'NORMAL')
        ORDER BY ml.expiry_date ASC NULLS LAST, ml.lifecycle_status
        LIMIT 10`;
      const { rows } = await query(sql);
      if (!rows.length) return { sql, explanation: zh ? "✅ 未来 90 天内无到期批次" : "✅ No lots expiring within 90 days" };
      const lines = rows.map((r, i) => {
        const d = r.expiryDate ? (r.expiryDate instanceof Date ? r.expiryDate.toISOString().slice(0, 10) : String(r.expiryDate).slice(0, 10)) : "?";
        const badge = r.lifecycleStatus && r.lifecycleStatus !== "NORMAL" ? ` [${r.lifecycleStatus}]` : "";
        return `${i + 1}. ${r.materialCode} ${nameOf(r)} 批次 ${r.lotNo} — ${d}（${_invNum(r.qty)}）${badge}`;
      });
      const title = zh ? `⏳ 临期/效期预警批次（${rows.length}）` : `⏳ Expiry warning lots (${rows.length})`;
      return { sql, explanation: `${title}\n${lines.join("\n")}` };
    }

    // ── 5) By supplier ───────────────────────────────────────────────────────
    if (/(供应商|厂商|supplier|vendor)/i.test(q)) {
      const sql = `SELECT s.code AS "supplierCode",
          COALESCE(s.name_zh, s.name_en) AS "supplierName",
          COUNT(*) AS "lotCount",
          COALESCE(SUM(ml.received_qty - COALESCE(ml.reserved_qty, 0)), 0) AS "totalQty"
        FROM material_lots ml
        JOIN suppliers s ON s.id = ml.supplier_id
        WHERE ml.lot_status = 'open'
        GROUP BY s.code, s.name_zh, s.name_en
        ORDER BY "totalQty" DESC
        LIMIT 10`;
      const { rows } = await query(sql);
      if (!rows.length) return { sql, explanation: zh ? "[暂无供应商库存数据]" : "[No supplier data]" };
      const lines = rows.map((r, i) => `${i + 1}. ${r.supplierCode} ${r.supplierName} — 合计 ${_invNum(r.totalQty)}（${r.lotCount} 批）`);
      const title = zh ? `🏭 按供应商汇总库存（${rows.length}）` : `🏭 Inventory by supplier (${rows.length})`;
      return { sql, explanation: `${title}\n${lines.join("\n")}` };
    }

    // ── 6) By location ───────────────────────────────────────────────────────
    if (/(库位|储位|location|shelf\s*cell)/i.test(q)) {
      const sql = `SELECT COALESCE(sl.code, '(未分配)') AS "locationCode",
          COUNT(*) AS "lotCount",
          COALESCE(SUM(ml.received_qty - COALESCE(ml.reserved_qty, 0)), 0) AS "totalQty"
        FROM material_lots ml
        LEFT JOIN storage_locations sl ON sl.id = ml.storage_location_id
        WHERE ml.lot_status = 'open'
        GROUP BY sl.code
        ORDER BY "totalQty" DESC
        LIMIT 10`;
      const { rows } = await query(sql);
      if (!rows.length) return { sql, explanation: zh ? "[暂无库位数据]" : "[No location data]" };
      const lines = rows.map((r, i) => `${i + 1}. ${r.locationCode} — ${_invNum(r.totalQty)}（${r.lotCount} 批）`);
      const title = zh ? `📍 按库位库存分布（${rows.length}）` : `📍 Inventory by location (${rows.length})`;
      return { sql, explanation: `${title}\n${lines.join("\n")}` };
    }

    // ── 7) Summary / default ─────────────────────────────────────────────────
    const sql = `SELECT COUNT(*) AS "lotCount",
          COUNT(DISTINCT ml.material_id) AS "materialCount",
          COALESCE(SUM(ml.received_qty - COALESCE(ml.reserved_qty, 0)), 0) AS "totalQty",
          COUNT(*) FILTER (WHERE ml.iqc_status IN ('hold','pending')) AS "pendingIqc",
          COUNT(*) FILTER (WHERE ml.iqc_status = 'rejected') AS "rejected"
        FROM material_lots ml
        WHERE ml.lot_status = 'open'`;
    const [sum, byStatus] = await Promise.all([
      query(sql),
      query(`SELECT iqc_status, COUNT(*) AS n FROM material_lots WHERE lot_status='open' GROUP BY iqc_status`),
    ]);
    const r = sum.rows[0];
    const statusLine = byStatus.rows.map((x) => `${x.iqc_status}: ${x.n}`).join(" · ");
    const explanation = zh
      ? `📦 库存总览（实时）\n活跃批次 ${_invNum(r.lotCount)} · 物料 ${_invNum(r.materialCount)} · 可用总量 ${_invNum(r.totalQty)}\nIQC: ${statusLine}\n待检/HOLD ${_invNum(r.pendingIqc)} · 不合格 ${_invNum(r.rejected)}`
      : `📦 Inventory summary (live)\nActive lots ${_invNum(r.lotCount)} · materials ${_invNum(r.materialCount)} · total qty ${_invNum(r.totalQty)}\nIQC: ${statusLine}\npending/HOLD ${_invNum(r.pendingIqc)} · rejected ${_invNum(r.rejected)}`;
    return { sql, explanation };
  } catch (err) {
    console.error("[llm/askInventoryQuery]", err.message);
    return fallback(err.message);
  }
}

export async function askTraceQuery(prompt) {
  return {
    sql: "",
    explanation: "[追溯查询需要更完整的实现]",
  };
}

export async function askReport(params) {
  return { html: "<p>[报表生成需要更完整的实现]</p>" };
}

export async function health() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${OLLAMA_URL}/api/tags`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return { status: "error", model: "none", error: `HTTP ${res.status}` };
    const data = await res.json();
    const models = data.models ?? [];
    const defaultModel = models.find((m) => m.name === DEFAULT_MODEL) ?? models[0];
    return {
      status: "ok",
      model: defaultModel?.name ?? "unknown",
      models: models.map((m) => ({ name: m.name, size: m.size, modified: m.modified_at })),
      reachable: true,
      modelAvailable: !!defaultModel,
    };
  } catch (err) {
    return { status: "error", model: "none", error: err.message, reachable: false, modelAvailable: false, models: [] };
  }
}
