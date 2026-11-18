/**
 * OQC AQL 出货抽检 (native PG).
 *
 * Reuses the existing `qms_oqc_batches` / `qms_oqc_items` tables — the AQL
 * engine here computes the Z1.4 sample plan, records per-SN results and judges
 * the lot against CR/MA/MI acceptance numbers.
 *
 *   GET  /qms/oqc-aql/plan           预览抽样方案（不落库）
 *   GET  /qms/oqc-aql/batches        批量列表
 *   POST /qms/oqc-aql/batches        新建批 + 套用抽样方案
 *   GET  /qms/oqc-aql/batches/:id    批详情 + 当前判定（dry-run）
 *   POST /qms/oqc-aql/batches/:id/items   记录单件结果
 *   POST /qms/oqc-aql/batches/:id/judge   正式判定（写回批状态）
 *   POST /qms/oqc-aql/batches/:id/review  处置（返工/特采/报废）
 */

import { Router } from "express";
import { randomUUID } from "node:crypto";
import { getClient, query } from "../db.js";
import { envelope, errorEnvelope, listEnvelope } from "../shared/helpers.js";
import { plansFor, verdict } from "../aql.js";

export function createOqcAqlRouter({ authenticateJWT, requirePermission }) {
  const router = Router();

  const asNum = (v, d) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  };

  const normalize = (body = {}) => ({
    lotQty: asNum(body.lotQty ?? body.totalQty, 0),
    aqlMa: asNum(body.aqlMa, 1.0),
    aqlMi: asNum(body.aqlMi, 2.5),
    level: String(body.level ?? "II").trim().toUpperCase() || "II",
    severity: String(body.severity ?? "normal").trim().toLowerCase() || "normal",
  });

  /** Reconstruct a plan from the stored batch row (for judging). */
  const planFromRow = (row) => {
    const n = row.sample_size ?? row.ma_n ?? 0;
    return {
      ok: true,
      n,
      code: row.sample_code,
      cr: { ac: row.ac_critical ?? 0, re: 1 },
      ma: { ac: row.ac_major ?? 0, re: row.re_major ?? 1, n },
      mi: { ac: row.ac_minor ?? 0, re: row.re_minor ?? 1, n },
    };
  };

  const countsBySeverity = (items) => {
    const c = { cr: 0, ma: 0, mi: 0 };
    for (const item of items) {
      if (item.result !== "FAIL") continue;
      const sev = String(item.severity || "").toUpperCase();
      if (sev === "CR") c.cr += 1;
      else if (sev === "MI") c.mi += 1;
      else c.ma += 1; // 未标注严重度的 FAIL 一律按主要缺陷
    }
    return c;
  };

  // ── 抽样方案预览 ─────────────────────────────────────────────────────────
  router.get("/plan", authenticateJWT, requirePermission("qms.read"), (req, res) => {
    const { lotQty, aqlMa, aqlMi, level, severity } = normalize(req.query);
    const plan = plansFor(lotQty, aqlMa, aqlMi, level, severity);
    if (!plan.ok) return res.status(400).json(errorEnvelope("AQL_PLAN_INVALID", plan.note));
    return res.json(envelope(plan));
  });

  // ── 批量列表 ─────────────────────────────────────────────────────────────
  router.get("/batches", authenticateJWT, requirePermission("qms.read"), async (req, res) => {
    try {
      const status = req.query.status ? String(req.query.status).toUpperCase() : null;
      const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500);
      const rows = (await query(
        `SELECT b.id, b.batch_no AS "batchNo", b.shipment_no AS "shipmentNo",
                b.customer_code AS "customerCode", b.customer_name AS "customerName",
                b.customer_po_no AS "customerPoNo", b.inspection_type AS "inspectionType",
                b.status, b.total_qty AS "totalQty", b.sample_size AS "sampleSize",
                b.sample_code AS "sampleCode", b.lot_code AS "lotCode",
                b.inspection_level AS "inspectionLevel", b.severity_profile AS "severityProfile",
                b.aql_ma AS "aqlMa", b.aql_mi AS "aqlMi",
                b.ac_critical AS "acCritical", b.ac_major AS "acMajor", b.ac_minor AS "acMinor",
                b.disposition, b.inspector_name AS "inspectorName",
                b.inspection_started_at AS "startedAt", b.inspection_completed_at AS "completedAt",
                b.created_at AS "createdAt",
                (SELECT count(*) FROM qms_oqc_items i WHERE i.batch_id = b.id) AS "itemCount"
           FROM qms_oqc_batches b
          ${status ? "WHERE b.status = $1" : ""}
          ORDER BY b.created_at DESC
          LIMIT ${limit}`,
        status ? [status] : [],
      )).rows;
      return res.json(listEnvelope(rows, rows.length));
    } catch (err) {
      console.error("GET /qms/oqc-aql/batches:", err.message);
      return res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
    }
  });

  // ── 新建批 ───────────────────────────────────────────────────────────────
  router.post("/batches", authenticateJWT, requirePermission("quality.inspect"), async (req, res) => {
    const body = req.body?.payload ?? req.body ?? {};
    const { lotQty, aqlMa, aqlMi, level, severity } = normalize(body);
    const plan = plansFor(lotQty, aqlMa, aqlMi, level, severity);
    if (!plan.ok) return res.status(400).json(errorEnvelope("AQL_PLAN_INVALID", plan.note));

    const batchNo = String(body.batchNo || body.batch_no || `OQC-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${randomUUID().slice(0, 6).toUpperCase()}`).trim();
    const client = await getClient();
    try {
      await client.query("BEGIN");
      const row = (await client.query(
        `INSERT INTO qms_oqc_batches(
           batch_no, shipment_no, customer_code, customer_name, customer_po_no,
           inspection_type, status, total_qty, sample_size,
           aql_level, inspection_level, severity_profile,
           aql_ma, aql_mi, sample_code, lot_code,
           ac_critical, ac_major, re_major, ac_minor, re_minor,
           ac_reject, re_pass, plan_source, plan_note,
           inspector_id, inspector_name, inspection_started_at, remarks)
         VALUES($1,$2,$3,$4,$5,$6,'SAMPLING',$7,$8,$9,$10,$11,
                $12,$13,$14,$15,
                $16,$17,$18,$19,$20,
                $21,$22,'z1.4',$23,
                $24,$25,NOW(),$26)
         RETURNING id, batch_no AS "batchNo", status, sample_size AS "sampleSize",
           sample_code AS "sampleCode", ac_critical AS "acCritical",
           ac_major AS "acMajor", re_major AS "reMajor", ac_minor AS "acMinor", re_minor AS "reMinor"`,
        [batchNo, body.shipmentNo || body.shipment_no || null,
          body.customerCode || body.customer_code || null,
          body.customerName || body.customer_name || null,
          body.customerPoNo || body.customer_po_no || null,
          String(body.inspectionType || "OQC").toUpperCase(),
          lotQty, plan.n,
          level, level, severity,
          plan.ma.aql, plan.mi.aql, plan.code, plan.lotCode,
          plan.cr.ac, plan.ma.ac, plan.ma.re, plan.mi.ac, plan.mi.re,
          plan.ma.ac, plan.ma.re,
          [plan.ma.note, plan.mi.note].filter(Boolean).join(" · ") || null,
          req.user?.id || null, req.user?.username || null,
          body.remarks || null],
      )).rows[0];
      await client.query("COMMIT");
      return res.status(201).json(envelope({ ...row, plan }));
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("POST /qms/oqc-aql/batches:", err.message);
      return res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
    } finally {
      client.release();
    }
  });

  // ── 批详情 + dry-run 判定 ────────────────────────────────────────────────
  router.get("/batches/:id", authenticateJWT, requirePermission("qms.read"), async (req, res) => {
    try {
      const row = (await query(
        `SELECT b.*, b.batch_no AS "batchNo", b.shipment_no AS "shipmentNo",
                b.customer_code AS "customerCode", b.customer_name AS "customerName",
                b.customer_po_no AS "customerPoNo", b.inspection_type AS "inspectionType",
                b.total_qty AS "totalQty", b.sample_size AS "sampleSize",
                b.sample_code AS "sampleCode", b.lot_code AS "lotCode",
                b.inspection_level AS "inspectionLevel", b.severity_profile AS "severityProfile",
                b.aql_ma AS "aqlMa", b.aql_mi AS "aqlMi",
                b.ac_critical AS "acCritical", b.ac_major AS "acMajor",
                b.re_major AS "reMajor", b.ac_minor AS "acMinor", b.re_minor AS "reMinor",
                b.plan_note AS "planNote", b.disposition, b.disposition_reason AS "dispositionReason",
                b.inspector_name AS "inspectorName", b.remarks
           FROM qms_oqc_batches b WHERE b.id = $1`,
        [req.params.id],
      )).rows[0];
      if (!row) return res.status(404).json(errorEnvelope("NOT_FOUND", "批不存在"));
      const items = (await query(
        `SELECT id, sn, result, severity, defect_code AS "defectCode",
                defect_desc AS "defectDesc", location, inspector_name AS "inspectorName",
                inspection_time AS "inspectionTime"
           FROM qms_oqc_items WHERE batch_id = $1 ORDER BY inspection_time, id`,
        [req.params.id],
      )).rows;
      const counts = countsBySeverity(items);
      const plan = planFromRow(row);
      return res.json(envelope({
        batch: row,
        items,
        counts,
        verdict: verdict(counts, plan),
      }));
    } catch (err) {
      console.error("GET /qms/oqc-aql/batches/:id:", err.message);
      return res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
    }
  });

  // ── 记录单件结果 ─────────────────────────────────────────────────────────
  router.post("/batches/:id/items", authenticateJWT, requirePermission("quality.inspect"), async (req, res) => {
    const body = req.body?.payload ?? req.body ?? {};
    const sn = String(body.sn || body.pcbSerial || "").trim().toUpperCase();
    const result = String(body.result || "PASS").trim().toUpperCase();
    if (!sn) return res.status(400).json(errorEnvelope("VALIDATION", "sn is required"));
    if (!["PASS", "FAIL"].includes(result)) {
      return res.status(400).json(errorEnvelope("VALIDATION", "result must be PASS or FAIL"));
    }
    const severity = result === "FAIL" ? String(body.severity || "MA").trim().toUpperCase() : null;
    if (result === "FAIL" && !["CR", "MA", "MI"].includes(severity)) {
      return res.status(400).json(errorEnvelope("VALIDATION", "FAIL requires severity in CR/MA/MI"));
    }
    try {
      const existing = (await query(
        `SELECT id FROM qms_oqc_items WHERE batch_id = $1 AND upper(sn) = $2 LIMIT 1`,
        [req.params.id, sn],
      )).rows[0];
      if (existing) {
        // 重扫同一 SN = 更正，不重复计数
        await query(
          `UPDATE qms_oqc_items
              SET result = $2, severity = $3, defect_code = $4, defect_desc = $5,
                  location = $6, inspector_id = $7, inspector_name = $8, inspection_time = NOW()
            WHERE id = $1`,
          [existing.id, result, severity,
            body.defectCode || body.defect_code || null,
            body.defectDesc || body.defect_desc || null,
            body.location || null, req.user?.id || null, req.user?.username || null],
        );
      } else {
        await query(
          `INSERT INTO qms_oqc_items(batch_id, sn, result, severity, defect_code,
             defect_desc, location, inspector_id, inspector_name, inspection_time)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())`,
          [req.params.id, sn, result, severity,
            body.defectCode || body.defect_code || null,
            body.defectDesc || body.defect_desc || null,
            body.location || null, req.user?.id || null, req.user?.username || null],
        );
      }
      return res.status(201).json(envelope({ sn, result, severity, corrected: Boolean(existing) }));
    } catch (err) {
      console.error("POST /qms/oqc-aql/batches/:id/items:", err.message);
      return res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
    }
  });

  // ── 正式判定 ─────────────────────────────────────────────────────────────
  router.post("/batches/:id/judge", authenticateJWT, requirePermission("quality.inspect"), async (req, res) => {
    const client = await getClient();
    try {
      await client.query("BEGIN");
      const row = (await client.query(
        `SELECT * FROM qms_oqc_batches WHERE id = $1 FOR UPDATE`,
        [req.params.id],
      )).rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        return res.status(404).json(errorEnvelope("NOT_FOUND", "批不存在"));
      }
      if (!row.sample_size) {
        await client.query("ROLLBACK");
        return res.status(400).json(errorEnvelope("NO_PLAN", "该批还没有抽样方案"));
      }
      const items = (await client.query(
        `SELECT result, severity FROM qms_oqc_items WHERE batch_id = $1`,
        [req.params.id],
      )).rows;
      const counts = countsBySeverity(items);
      const judged = verdict(counts, planFromRow(row));
      const status = judged.accepted ? "PASSED" : "FAILED";
      await client.query(
        `UPDATE qms_oqc_batches
            SET status = $2,
                passed_qty = $3, failed_qty = $4,
                inspection_completed_at = NOW(), updated_at = NOW()
          WHERE id = $1`,
        [req.params.id, status,
          judged.accepted ? row.sample_size : Math.max(0, row.sample_size - (counts.cr + counts.ma + counts.mi)),
          counts.cr + counts.ma + counts.mi],
      );
      await client.query("COMMIT");
      return res.json(envelope({ batchId: row.id, batchNo: row.batch_no, status, counts, verdict: judged }));
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("POST /qms/oqc-aql/batches/:id/judge:", err.message);
      return res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
    } finally {
      client.release();
    }
  });

  // ── 处置 ─────────────────────────────────────────────────────────────────
  router.post("/batches/:id/review", authenticateJWT, requirePermission("quality.write"), async (req, res) => {
    const body = req.body?.payload ?? req.body ?? {};
    const decision = String(body.decision || "").trim().toUpperCase();
    if (!["REWORK", "WAIVER", "SCRAP"].includes(decision)) {
      return res.status(400).json(errorEnvelope("VALIDATION", "decision must be REWORK/WAIVER/SCRAP"));
    }
    const reason = String(body.reason || body.reject_reason || "").trim();
    if (!reason) return res.status(400).json(errorEnvelope("VALIDATION", "reason is required"));
    try {
      const row = (await query(
        `UPDATE qms_oqc_batches
            SET disposition = $2, disposition_reason = $3,
                disposition_by = $4, disposition_at = NOW(), updated_at = NOW()
          WHERE id = $1
          RETURNING id, batch_no AS "batchNo", status, disposition,
            disposition_reason AS "dispositionReason", disposition_by AS "dispositionBy",
            disposition_at AS "dispositionAt"`,
        [req.params.id, decision, reason, req.user?.username || "unknown"],
      )).rows[0];
      if (!row) return res.status(404).json(errorEnvelope("NOT_FOUND", "批不存在"));
      return res.json(envelope(row));
    } catch (err) {
      console.error("POST /qms/oqc-aql/batches/:id/review:", err.message);
      return res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
    }
  });

  return router;
}