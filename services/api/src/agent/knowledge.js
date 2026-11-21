// Field knowledge for every virtual employee, written through the shared
// knowledge policy (services/_shared/memory-experience.js).
//
// What counts as knowledge here: a claim about the employee's field that is
// derived from real rows and carries a source pointer + expiry. Aggregate
// statistics are NOT knowledge — they stay in `npm run report:ve` and SQL.
// Runtime state snapshots are refused outright by the policy (TRANSIENT_STATE).

import { FACTORY_VIRTUAL_EMPLOYEES } from "../virtual-employees/registry.js";
import { createKnowledgeService, employeeAgentId } from "../../../_shared/memory-experience.js";
// Each item is one sentence about the field, tied to the rows it came from.
export const FIELD_QUERIES = Object.freeze({
  "IQC-VIRTUAL-01": [
    { type: "exception_signature", topic: "supplier-defect-history", sql: `
        SELECT supplier_code, material_code, count(*) AS ng, max(id) AS source_id
        FROM iqc_inspections WHERE inspection_result='FAIL' AND supplier_code IS NOT NULL
        GROUP BY 1,2 HAVING count(*)>0 ORDER BY ng DESC LIMIT 10`,
      render: r => `供应商 ${r.supplier_code} 的物料 ${r.material_code} 在来料检验中出现 ${r.ng} 次不合格，判定前须先复核该供应商的缺陷特征。` },
  ],
  "WMS-RECEIVING-VIRTUAL-01": [
    { type: "exception_signature", topic: "receipt-backlog", sql: `
        SELECT supplier_code, material_code, count(*) AS pending, max(id) AS source_id
        FROM wms_receipt_orders WHERE status='pending_iqc' AND supplier_code IS NOT NULL
        GROUP BY 1,2 ORDER BY pending DESC LIMIT 10`,
      render: r => `供应商 ${r.supplier_code} 有 ${r.pending} 批物料处于待检状态，收料确认前必须保持 HOLD 并交 IQC 判定。` },
  ],
  "WMS-INVENTORY-VIRTUAL-01": [
    { type: "exception_signature", topic: "unsigned-packages", sql: `
        SELECT line_code, count(*) AS unsigned, max(id) AS source_id
        FROM wms_fetch_packages WHERE status='PREPARED' AND received_at IS NULL
        GROUP BY 1 ORDER BY unsigned DESC LIMIT 10`,
      render: r => `${r.line_code || "未知线体"} 有 ${r.unsigned} 个包裹未签收，FOFO 与库位冲突判定须把未签收量排除在可用库存外。` },
  ],
  "MAINTENANCE-VIRTUAL-01": [
    { type: "exception_signature", topic: "wear-alerts", sql: `
        SELECT alert_type, severity, count(*) AS open, max(id) AS source_id
        FROM parts_wear_alerts WHERE resolved_at IS NULL GROUP BY 1,2 ORDER BY open DESC LIMIT 10`,
      render: r => `告警类型 ${r.alert_type}（${r.severity || "未分级"}）当前有 ${r.open} 条未解决，设备可用率判定须先核对这一类磨损。` },
  ],
  "OA-DOCUMENT-CONTROL-VIRTUAL-01": [
    { type: "exception_signature", topic: "approval-bottlenecks", sql: `
        SELECT approver_role, count(*) AS pending, max(id) AS source_id
        FROM over_picking_orders WHERE status='pending' GROUP BY 1 ORDER BY pending DESC LIMIT 10`,
      render: r => `角色 ${r.approver_role || "未指定"} 有 ${r.pending} 张超领单未签，催办优先级按此排序。` },
  ],
  "QUALITY-VIRTUAL-01": [
    { type: "exception_signature", topic: "rework-dispositions", sql: `
        SELECT disposition_id, count(*) AS n, max(id) AS source_id
        FROM rework_orders WHERE status NOT IN ('closed','completed') GROUP BY 1 ORDER BY n DESC LIMIT 10`,
      render: r => `处置方式 ${r.disposition_id || "未指定"} 下有 ${r.n} 张未闭环返工单，返工次数上限判定须先检查该处置路径。` },
  ],
  "SUPPLIER-COLLAB-VIRTUAL-01": [
    { type: "exception_signature", topic: "open-returns", sql: `
        SELECT supplier_code, count(*) AS open, max(id) AS source_id
        FROM supplier_return_order WHERE status NOT IN ('out','completed') GROUP BY 1 ORDER BY open DESC LIMIT 10`,
      render: r => `供应商 ${r.supplier_code || "未知"} 有 ${r.open} 张未闭环退货单，门户数据与来料判定须按此风险加权。` },
  ],
});

const DAY_MS = 86400000;

export async function collectFieldKnowledge({ employeeId, query, knowledge, now = Date.now(), dryRun = false }) {
  const employee = FACTORY_VIRTUAL_EMPLOYEES.find(e => e.id === employeeId);
  if (!employee) return { employeeId, skipped: "EMPLOYEE_NOT_FOUND" };
  const sources = FIELD_QUERIES[employeeId] || [];
  const items = [];
  for (const source of sources) {
    const rows = (await query(source.sql)).rows;
    for (const row of rows) {
      const content = source.render(row);
      const meta = {
        type: source.type, topic: source.topic,
        sourceType: source.topic, sourceId: row.source_id,
        expiresAt: new Date(now + 180 * DAY_MS).toISOString(),
      };
      const entry = { employeeId, content, ...meta };
      if (dryRun || !knowledge) { items.push({ ...entry, stored: false }); continue; }
      const result = await knowledge.remember({ employeeId, content, ...meta });
      items.push({ ...entry, ...result });
    }
  }

  const stored = items.filter(i => i.stored).length;
  if (stored > 0) {
    await query(
      `INSERT INTO factory_virtual_employee_events(employee_id,task_id,event_type,detail,actor)
       VALUES ($1,NULL,'KNOWLEDGE_COLLECTED',$2::jsonb,$3)`,
      [employeeId, JSON.stringify({ items: items.length, stored,
        refused: [...new Set(items.filter(i => !i.stored && i.reason).map(i => i.reason))] }),
        `ve:${employeeId}`],
    );
  }
  return { employeeId, field: employee.domain, namespace: employeeAgentId(employeeId),
    collected: items.length, stored, refused: items.length - stored,
    reasons: [...new Set(items.filter(i => i.reason).map(i => i.reason))], items, dryRun };
}

export async function knowledgeCycle({ employeeIds, query, knowledge, dryRun = false }) {
  const results = [];
  for (const id of employeeIds) results.push(await collectFieldKnowledge({ employeeId: id, query, knowledge, dryRun }));
  return { employees: results.length, collected: results.reduce((s, r) => s + (r.collected || 0), 0),
    stored: results.reduce((s, r) => s + (r.stored || 0), 0), results };
}

export function allKnowledgeEmployeeIds() {
  return FACTORY_VIRTUAL_EMPLOYEES.map(e => e.id);
}

export function defaultKnowledgeService() {
  return createKnowledgeService();
}

// ── L1 语料：OA 受控文件（版本化、可失效）──────────────────────────────
// oa.doc_system holds the controlled-document register (260 published rows).
// Only the authority levels go into the index by default: l1 manual, l2
// procedure, l3 management rule. l4 forms are blanks — 181 near-identical
// titles would dilute recall without telling an employee anything.
export const DOC_LEVELS_DEFAULT = Object.freeze([1, 2, 3]);

export async function collectControlledDocs({ query, knowledge, levels = DOC_LEVELS_DEFAULT, limit = 300, dryRun = false,
  // the event table is per-employee (NOT NULL); the controlled-document
  // register belongs to the document-control role, which owns its currency.
  ownerEmployeeId = "OA-DOCUMENT-CONTROL-VIRTUAL-01" }) {
  const rows = (await query(
    `SELECT id, code, title, title_vi, level, category, current_version, issue_date, next_review_date, security_level
       FROM oa.doc_system
      WHERE status = 'published'
        AND level = ANY($1::int[])
        AND COALESCE(security_level, 'public') = 'public'
      ORDER BY level, code
      LIMIT $2`, [levels, limit])).rows;

  const items = [];
  for (const row of rows) {
    const version = String(row.current_version || "").trim();
    // pg hands back timestamptz as a Date; String(date).slice() produced
    // "Mon Au…" garbage, so format explicitly.
    const reviewDate = row.next_review_date ? new Date(row.next_review_date).toISOString().slice(0, 10) : "未定";
    const content = `受控文件 ${row.code}《${row.title}》（L${row.level}/${row.category}）当前版本 ${version || "未标注"}；引用时必须带版本号，下次复审 ${reviewDate}。`
      + (row.title_vi ? ` 越文名：${row.title_vi}` : "");
    const meta = {
      type: "rule_reference", topic: "controlled-document",
      sourceType: "oa-doc-system", sourceId: row.id,
      docVersion: version || null,
      expiresAt: row.next_review_date ? new Date(row.next_review_date).toISOString() : null,
    };
    if (!meta.docVersion) { items.push({ code: row.code, stored: false, reason: "NO_VERSION_ON_DOCUMENT" }); continue; }
    if (dryRun || !knowledge) { items.push({ code: row.code, level: row.level, ...meta, stored: false }); continue; }
    const result = await knowledge.remember({ ...meta, content, shared: "controlled-docs" });
    items.push({ code: row.code, level: row.level, ...result });
  }

  const stored = items.filter(i => i.stored).length;
  if (stored > 0) {
    await query(
      `INSERT INTO factory_virtual_employee_events(employee_id,task_id,event_type,detail,actor)
       VALUES ($1,NULL,'KNOWLEDGE_COLLECTED',$2::jsonb,$3)`,
      [ownerEmployeeId, JSON.stringify({ kind: "controlled-docs", levels, scanned: rows.length, stored,
        refused: [...new Set(items.filter(i => !i.stored && i.reason).map(i => i.reason))] }),
        `ve:${ownerEmployeeId}`],
    );
  }
  return { source: "oa.doc_system", owner: ownerEmployeeId, levels, scanned: rows.length, stored,
    refused: items.length - stored,
    reasons: [...new Set(items.filter(i => i.reason).map(i => i.reason))],
    namespace: "ve/shared/controlled-docs", dryRun, items };
}
