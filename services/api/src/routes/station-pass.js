// ── Native station-pass engine (PostgreSQL) ────────────────────────────────
// Parity with the Python MES `/exec/pass` chain, persisted on PG:
//   POST /api/mes/station-pass                    过站（校验链 + 记录）
//   GET  /api/mes/station-pass/status/:identity   当前应到工位 / NG / 重测状态
//   GET  /api/mes/station-pass/history            过站事件
//   GET  /api/mes/station-pass/policies           每站防呆策略
//   PUT  /api/mes/station-pass/policies/:code     维护策略
//   POST /api/mes/station-pass/skip-releases      申请跳站放行单
//   POST /api/mes/station-pass/skip-releases/:no/approve|reject
//   GET  /api/mes/station-pass/skip-releases      放行单列表

import { createHash, randomUUID } from "node:crypto";
import { Router } from "express";
import { getClient, query } from "../db.js";
import { envelope, errorEnvelope, listEnvelope } from "../shared/helpers.js";
import { evaluateStationPass } from "../station-pass.js";

/**
 * server.js owns the JWT + permission middleware, so they are injected here
 * instead of being re-implemented in this module.
 */
export function createStationPassRouter({ authenticateJWT, requirePermission }) {
const router = Router();

const asLimit = (value, fallback = 50, max = 500) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
};

const DEFAULT_POLICY = Object.freeze({
  deny_manual_pass: false,
  allow_repeat_pass: false,
  max_retest: 0,
  min_dwell_minutes: 0,
  require_upstream_ok: true,
});

/** Label the failing statement so a 500 says which INSERT broke, not just "db error". */
async function runQuery(client, label, sql, params = []) {
  try {
    return await client.query(sql, params);
  } catch (err) {
    err.message = `${label}: ${err.message}`;
    throw err;
  }
}

async function loadStation(code) {
  return (await query(
    `SELECT s.code, s.status, pl.internal_code AS line_code
       FROM stations s
       LEFT JOIN production_lines pl ON pl.id = s.line_id
      WHERE lower(s.code) = lower($1)
      LIMIT 1`,
    [code],
  )).rows[0] || null;
}

async function loadPolicy(stationCode) {
  const row = (await query(
    `SELECT * FROM mes_station_pass_policies WHERE station_code = $1`,
    [stationCode],
  )).rows[0];
  return { ...DEFAULT_POLICY, ...(row || {}) };
}

async function loadRoute(lineCode) {
  // station_sequences 有两种写法：有的线存真实工位码（PDA-01），有的线存工位
  // 类型码（smt_aoi）。两种都要认，否则路线整条对不上、首站建档会指到一个
  // 根本不存在的工位。直接命中优先，其次按同线同类型解析。
  const rows = (await query(
    `SELECT ss.sequence_order,
            ss.station_code AS route_code,
            COALESCE(
              (SELECT s.code FROM stations s
                 JOIN production_lines pl ON pl.id = s.line_id
                WHERE pl.internal_code = ss.line_code
                  AND lower(s.code) = lower(ss.station_code)
                LIMIT 1),
              (SELECT s.code FROM stations s
                 JOIN production_lines pl ON pl.id = s.line_id
                 JOIN station_types st ON st.id = s.station_type_id
                WHERE pl.internal_code = ss.line_code
                  AND st.code = ss.station_code
                  AND s.status IN ('running', 'idle')
                ORDER BY s.code
                LIMIT 1)
            ) AS resolved_code
       FROM station_sequences ss
      WHERE ss.line_code = $1
      ORDER BY ss.sequence_order`,
    [lineCode],
  )).rows;
  return rows.map(row => ({
    sequence_order: row.sequence_order,
    station_code: row.resolved_code || row.route_code,
    resolved: Boolean(row.resolved_code),
  }));
}

function routeFacts(steps, stationCode, expectedStationCode) {
  const index = steps.findIndex(step => String(step.station_code).toLowerCase() === stationCode);
  return {
    firstStationCode: steps[0]?.station_code ?? null,
    expectedStationCode: expectedStationCode || (index >= 0 ? steps[index + 1]?.station_code ?? null : null),
    nextStationCode: index >= 0 ? steps[index + 1]?.station_code ?? null : null,
    currentStepIndex: index,
    stepsCount: steps.length,
    // 路线里每一条都必须能落到真实工位。只解析出一半的路线会让"下一站"
    // 指向一个不存在的编码，产品会被判完工或永远卡住。
    configured: steps.length > 0 && steps.every(step => step.resolved),
    stationOnRoute: index >= 0,
  };
}

/** Product facts: what the gate needs to know about this SN right now. */
async function loadProductFacts(client, product, stationCode) {
  const productId = product.product_id;
  const [visitsRes, sequenceRes, attendanceRes] = await Promise.all([
    client.query(
      `SELECT count(*)::int AS pass_count, max(completed_at) AS last_completed_at
         FROM mes_product_station_visits
        WHERE product_id = $1 AND lower(station_code) = lower($2) AND state = 'COMPLETED'`,
      [productId, stationCode],
    ),
    client.query(
      `SELECT sequence_id, sequence_type, ordered_steps, current_step_index
         FROM mes_product_dependent_sequences
        WHERE product_id = $1 AND state = 'ACTIVE'
        ORDER BY created_at
        LIMIT 1`,
      [productId],
    ),
    client.query(
      `SELECT attendance_id, current_step_id, route_snapshot
         FROM mes_product_attendance
        WHERE product_id = $1 AND state IN ('ACTIVE','HOLD')
        ORDER BY created_at DESC
        LIMIT 1`,
      [productId],
    ),
  ]);
  const lastVisitRes = await client.query(
    `SELECT max(completed_at) AS last_completed_at
       FROM mes_product_station_visits
      WHERE product_id = $1 AND state = 'COMPLETED'`,
    [productId],
  );
  const identities = (await client.query(
    `SELECT identity_value FROM mes_product_identifiers WHERE product_id = $1 AND status = 'ACTIVE'`,
    [productId],
  )).rows.map(row => String(row.identity_value));

  const sequence = sequenceRes.rows[0] || null;
  const steps = Array.isArray(sequence?.ordered_steps) ? sequence.ordered_steps : [];
  const remaining = steps.slice(Number(sequence?.current_step_index || 0))
    .map(step => step.stationCode || step.station_code)
    .filter(Boolean);

  let upstreamNgStationCode = null;
  if (identities.length) {
    const ng = (await client.query(
      `SELECT station_code FROM ng_defect_records
        WHERE upper(sn) = ANY($1::text[]) AND result = 'fail'
          AND coalesce(repair_status, 'pending') <> 'repaired'
        ORDER BY occurred_at DESC NULLS LAST, id DESC
        LIMIT 1`,
      [identities.map(value => value.toUpperCase())],
    )).rows[0];
    if (ng && String(ng.station_code).toLowerCase() !== stationCode) upstreamNgStationCode = ng.station_code;
  }

  const activeNg = sequence && ["NG", "REPAIR", "RETEST"].includes(sequence.sequence_type)
    ? { sequenceId: sequence.sequence_id, requiredStations: remaining }
    : null;
  const missingRequiredStationCodes = sequence?.sequence_type === "MISSING_STATION" ? remaining : [];

  return {
    productId,
    lifecycleState: product.lifecycle_state,
    expectedStationCode: product.expected_station_code,
    hasPassedThisStation: Number(visitsRes.rows[0]?.pass_count || 0) > 0,
    retestCount: Number(visitsRes.rows[0]?.pass_count || 0),
    lastCompletedAt: lastVisitRes.rows[0]?.last_completed_at || null,
    activeNg,
    missingRequiredStationCodes,
    upstreamNgStationCode,
    attendanceId: attendanceRes.rows[0]?.attendance_id || null,
  };
}

async function loadSkipRelease(client, identifier, stationCode) {
  const approved = (await client.query(
    `SELECT release_no AS "releaseNo",
            from_station_code AS "fromStationCode",
            to_station_code AS "toStationCode"
       FROM mes_skip_releases
      WHERE upper(identity_value) = upper($1) AND status = 'APPROVED'
        AND lower(to_station_code) = lower($2)
        AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY approved_at DESC
      LIMIT 1`,
    [identifier, stationCode],
  )).rows[0] || null;
  if (approved) return { skipRelease: approved, skipReleaseRequested: false };
  const pending = (await client.query(
    `SELECT release_no FROM mes_skip_releases
      WHERE upper(identity_value) = upper($1) AND status = 'PENDING'
      ORDER BY requested_at DESC LIMIT 1`,
    [identifier],
  )).rows[0];
  return { skipRelease: null, skipReleaseRequested: Boolean(pending) };
}

// ── 过站 ────────────────────────────────────────────────────────────────────
router.post("/", authenticateJWT, requirePermission("mes.execute"), async (req, res) => {
  const body = req.body || {};
  const identifier = String(body.sn || body.identifier || "").trim().toUpperCase();
  const stationCode = String(body.stationCode || "").trim();
  const result = String(body.result || "OK").trim().toUpperCase();
  const defectCode = String(body.defectCode || body.defect_code || "").trim();
  const source = String(body.source || "manual").trim().toLowerCase();
  const operatorId = String(req.user?.username || body.operatorId || "unknown");
  const idempotencyKey = String(body.idempotencyKey || `PASS-${identifier}-${stationCode}-${Date.now()}-${randomUUID().slice(0, 8)}`);

  if (!identifier || !stationCode) {
    return res.status(400).json(errorEnvelope("PASS_VALIDATION", "sn and stationCode are required"));
  }
  if (!["OK", "NG"].includes(result)) {
    return res.status(400).json(errorEnvelope("PASS_VALIDATION", "result must be OK or NG"));
  }

  const client = await getClient();
  try {
    await client.query("BEGIN");

    const replay = (await client.query(
      `SELECT * FROM mes_station_pass_events WHERE idempotency_key = $1`,
      [idempotencyKey],
    )).rows[0];
    if (replay) {
      await client.query("COMMIT");
      return res.json({
        ok: true, replay: true,
        decision: {
          accepted: replay.gate_state === "ALLOW", blocked: replay.gate_state !== "ALLOW",
          gateState: replay.gate_state, reasonCode: replay.reason_code, nextAction: replay.next_action,
          message: replay.request_payload?.message || replay.reason_code,
          productId: replay.product_id, passId: replay.pass_id,
        },
      });
    }

    const station = await loadStation(stationCode);
    if (!station) {
      await client.query("ROLLBACK");
      return res.status(404).json(errorEnvelope("STATION_INVALID", `工位不存在：${stationCode}`));
    }
    const policy = await loadPolicy(station.code);
    const steps = await loadRoute(station.line_code);

    const workOrderCode = String(body.workOrderCode || "").trim();
    let workOrder = null;
    if (workOrderCode) {
      const wo = (await client.query(
        `SELECT w.code, w.status, p.code AS product_code
           FROM work_orders w
           LEFT JOIN products p ON p.id = w.product_id
          WHERE w.code = $1
          LIMIT 1`,
        [workOrderCode],
      )).rows[0];
      workOrder = wo
        ? {
            code: wo.code,
            released: ["released", "running"].includes(String(wo.status).toLowerCase()),
            // mes_product_units.product_code 是 NOT NULL，首次建档必须带上品号
            productCode: wo.product_code || null,
          }
        : null;
    }

    let product = (await client.query(
      `SELECT u.* FROM mes_product_identifiers i
         JOIN mes_product_units u ON u.product_id = i.product_id
        WHERE upper(i.identity_value) = upper($1) AND i.status = 'ACTIVE'
        LIMIT 1
        FOR UPDATE OF u`,
      [identifier],
    )).rows[0] || null;

    const facts = product ? await loadProductFacts(client, product, station.code.toLowerCase()) : null;
    const route = routeFacts(steps, station.code.toLowerCase(), facts?.expectedStationCode);
    const skip = await loadSkipRelease(client, identifier, station.code);

    const decision = evaluateStationPass({
      identifier,
      stationCode: station.code,
      result,
      defectCode,
      source,
      station: {
        code: station.code,
        status: station.status,
        denyManualPass: policy.deny_manual_pass === true,
        allowRepeatPass: policy.allow_repeat_pass === true,
        maxRetest: policy.max_retest,
        minDwellMinutes: policy.min_dwell_minutes,
      },
      workOrder,
      route,
      product: facts,
      skipRelease: skip.skipRelease,
      skipReleaseRequested: skip.skipReleaseRequested,
    });

    const passId = `PASS-${randomUUID()}`;
    let productId = facts?.productId || null;
    let visitNo = null;

    if (decision.accepted) {
      // 1) 首站建档
      if (decision.registrationRequired) {
        // mes_product_units.product_code 是 NOT NULL；品号只能从工单带出来。
        if (!workOrder?.productCode) {
          await client.query("ROLLBACK");
          return res.status(400).json(errorEnvelope(
            "WORK_ORDER_NO_PRODUCT",
            `工单 ${workOrder?.code ?? "(未填)"} 没有关联品号，无法建档`,
          ));
        }
        productId = `PRD-${randomUUID()}`;
        const attendanceId = `ATT-${randomUUID()}`;
        // route_revision 是 varchar(80)：完整步骤链放 route_snapshot(jsonb)，
        // 这里只留 线别 + 内容指纹，既短又能校验路线是否变过。
        const routeFingerprint = createHash("sha1")
          .update(steps.map(s => `${s.sequence_order}:${s.station_code}`).join("|"))
          .digest("hex")
          .slice(0, 12);
        const routeRevision = `${station.line_code}:${routeFingerprint}`;
        const expected = route.nextStationCode || station.code;
        await runQuery(client, "insert mes_product_units",
          `INSERT INTO mes_product_units(product_id, work_order_code, product_code, line_code,
             lifecycle_state, current_station_code, expected_station_code, route_revision, created_by, detail)
           VALUES($1,$2,$3,$4,'IN_PRODUCTION',$5,$5,$6,$7,$8)`,
          [productId, workOrder.code, workOrder.productCode, station.line_code, station.code, routeRevision, operatorId,
            JSON.stringify({ registeredAt: station.code, identifier })],
        );
        await runQuery(client, "insert mes_product_identifiers",
          `INSERT INTO mes_product_identifiers(identity_id, product_id, identity_type, identity_value, created_by, detail)
           VALUES($1,$2,'PCBA_SN',$3,$4,$5)`,
          [`PID-${randomUUID()}`, productId, identifier, operatorId, JSON.stringify({ stationCode: station.code, source })],
        );
        await runQuery(client, "insert mes_product_attendance",
          `INSERT INTO mes_product_attendance(attendance_id, product_id, route_revision, route_snapshot, current_step_id)
           VALUES($1,$2,$3,$4,$5)`,
          [attendanceId, productId, routeRevision, JSON.stringify(steps), String(steps[0]?.station_code ?? station.code)],
        );
        product = { product_id: productId, expected_station_code: expected, lifecycle_state: "IN_PRODUCTION" };
        facts && (facts.attendanceId = attendanceId);
        decision.nextStationCode = route.nextStationCode;
      }

      // 2) 过站记录
      const attendanceId = facts?.attendanceId || (await client.query(
        `SELECT attendance_id FROM mes_product_attendance
          WHERE product_id = $1 AND state IN ('ACTIVE','HOLD') ORDER BY created_at DESC LIMIT 1`,
        [productId],
      )).rows[0]?.attendance_id || null;

      if (attendanceId) {
        const routeStepId = `${station.line_code}:${route.currentStepIndex >= 0 ? steps[route.currentStepIndex].sequence_order : 0}`;
        visitNo = Number((await client.query(
          `SELECT coalesce(max(visit_no),0) + 1 AS next_no FROM mes_product_station_visits
            WHERE attendance_id = $1 AND route_step_id = $2`,
          [attendanceId, routeStepId],
        )).rows[0].next_no);
        await client.query(
          `INSERT INTO mes_product_station_visits(visit_id, attendance_id, product_id, station_code, route_step_id,
             visit_no, state, arrived_at, completed_at, source_event_id, detail)
           VALUES($1,$2,$3,$4,$5,$6,'COMPLETED',NOW(),NOW(),$7,$8)`,
          [`VIS-${randomUUID()}`, attendanceId, productId, station.code, routeStepId, visitNo, passId,
            JSON.stringify({ result, defectCode: defectCode || null, source, operatorId })],
        );
      }

      // 3) 推进工位 / NG 分支
      if (result === "NG") {
        const attendanceForSequence = attendanceId;
        if (attendanceForSequence) {
          await client.query(
            `INSERT INTO mes_product_dependent_sequences(sequence_id, product_id, attendance_id, sequence_type,
               reason_code, parent_step_id, ordered_steps, current_step_index, state, created_by, detail)
             VALUES($1,$2,$3,'REPAIR',$4,$5,$6,0,'ACTIVE',$7,$8)`,
            [`SEQ-${randomUUID()}`, productId, attendanceForSequence, defectCode || "NG",
              `${station.line_code}:${route.currentStepIndex >= 0 ? steps[route.currentStepIndex].sequence_order : 0}`,
              JSON.stringify([{ stationCode: station.code, action: "REWORK" }]), operatorId,
              JSON.stringify({ passId, stationCode: station.code })],
          );
        }
        await client.query(
          `UPDATE mes_product_units
              SET expected_station_code = $2, lifecycle_state = 'IN_PRODUCTION', updated_at = NOW(), version = version + 1
            WHERE product_id = $1`,
          [productId, station.code],
        );
      } else {
        const next = route.nextStationCode;
        // 注意：$3 必须每处都带同样的显式类型。裸 $3 在 CASE WHEN $3 IS NULL
        // 里没有类型上下文，pg 会发 untyped null 并报“无法确定参数 $3 的数据类型”。
        await runQuery(client, "update mes_product_units (pass)",
          `UPDATE mes_product_units
              SET current_station_code = $2::varchar(64),
                  expected_station_code = $3::varchar(64),
                  lifecycle_state = CASE WHEN $3::varchar(64) IS NULL THEN 'COMPLETED' ELSE 'IN_PRODUCTION' END,
                  closed_at = CASE WHEN $3::varchar(64) IS NULL THEN NOW() ELSE closed_at END,
                  updated_at = NOW(), version = version + 1
            WHERE product_id = $1`,
          [productId, station.code, next],
        );
        if (!next) decision.gateState = "COMPLETED";
      }

      // 4) 消费放行单
      if (skip.skipRelease) {
        await runQuery(client, "consume skip release",
          `UPDATE mes_skip_releases
              SET status = 'CONSUMED', consumed_at = NOW(), consumed_by_pass_id = $2
            WHERE release_no = $1 AND status = 'APPROVED'`,
          [skip.skipRelease.releaseNo, passId],
        );
      }
    }

    // 5) 过站事件（成功与拦截都留痕）
    await client.query(
      `INSERT INTO mes_station_pass_events(pass_id, idempotency_key, identity_value, product_id, work_order_code,
         line_code, station_code, result, gate_state, reason_code, next_action, visit_no, retest_no,
         operator_id, source, defect_code, dwell_seconds, skip_release_no, request_payload)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [passId, idempotencyKey, identifier, productId, workOrder?.code || null, station.line_code,
        station.code, result, decision.gateState, decision.reasonCode, decision.nextAction, visitNo,
        facts?.retestCount ?? 0, operatorId, source, defectCode || null,
        Math.max(0, Math.floor((Date.now() - new Date(facts?.lastCompletedAt || Date.now()).getTime()) / 1000)),
        skip.skipRelease?.releaseNo || null,
        JSON.stringify({ message: decision.message, checks: decision.checks, body })],
    );

    if (decision.accepted) {
      await client.query(
        `INSERT INTO mes_operating_event_ledger(event_id, aggregate_type, aggregate_key, event_type, payload)
         VALUES($1,'PRODUCT',$2,$3,$4)`,
        [`EVT-${randomUUID()}`, identifier, result === "NG" ? "STATION_NG" : "STATION_PASS",
          JSON.stringify({ passId, stationCode: station.code, workOrderCode: workOrder?.code || null, decision })],
      );
    }

    await client.query("COMMIT");
    // 拦截也是"校验成功"：业务结论放 200，让前端能拿到完整规则链。
    // 4xx 只留给真正的传输/参数错误。
    return res.json({
      ok: true,
      replay: false,
      decision: { ...decision, productId, passId },
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("POST /mes/station-pass:", err.message);
    return res.status(500).json(errorEnvelope("STATION_PASS_FAILED", err.message));
  } finally {
    client.release();
  }
});

// ── 当前状态 ────────────────────────────────────────────────────────────────
router.get("/status/:identity", authenticateJWT, requirePermission("mes.view"), async (req, res) => {
  const client = await getClient();
  try {
    const identifier = String(req.params.identity || "").trim().toUpperCase();
    const product = (await client.query(
      `SELECT u.* FROM mes_product_identifiers i
         JOIN mes_product_units u ON u.product_id = i.product_id
        WHERE upper(i.identity_value) = upper($1) AND i.status = 'ACTIVE'
        LIMIT 1`,
      [identifier],
    )).rows[0];
    if (!product) {
      return res.json(envelope({ identifier, registered: false, expectedStationCode: null, lastPass: null }));
    }
    const facts = await loadProductFacts(client, product, String(product.current_station_code || "").toLowerCase());
    const last = (await client.query(
      `SELECT station_code AS "stationCode", result, gate_state AS "gateState", reason_code AS "reasonCode",
              decided_at AS "decidedAt"
         FROM mes_station_pass_events WHERE upper(identity_value) = upper($1)
        ORDER BY decided_at DESC LIMIT 1`,
      [identifier],
    )).rows[0] || null;
    const steps = await loadRoute(product.line_code);
    const route = routeFacts(steps, String(product.current_station_code || "").toLowerCase(), product.expected_station_code);
    return res.json(envelope({
      identifier,
      registered: true,
      productId: product.product_id,
      lifecycleState: product.lifecycle_state,
      workOrderCode: product.work_order_code,
      lineCode: product.line_code,
      currentStationCode: product.current_station_code,
      expectedStationCode: product.expected_station_code,
      nextStationCode: route.nextStationCode,
      activeNg: facts.activeNg,
      retestCount: facts.retestCount,
      upstreamNgStationCode: facts.upstreamNgStationCode,
      lastPass: last,
    }));
  } catch (err) {
    console.error("GET /mes/station-pass/status:", err.message);
    return res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  } finally {
    client.release();
  }
});

// ── 过站历史 ────────────────────────────────────────────────────────────────
router.get("/history", authenticateJWT, requirePermission("mes.view"), async (req, res) => {
  try {
    const params = [];
    const where = [];
    if (req.query.identity) { params.push(String(req.query.identity).toUpperCase()); where.push(`upper(identity_value) = $${params.length}`); }
    if (req.query.stationCode) { params.push(String(req.query.stationCode)); where.push(`lower(station_code) = lower($${params.length})`); }
    if (req.query.workOrderCode) { params.push(String(req.query.workOrderCode)); where.push(`work_order_code = $${params.length}`); }
    if (req.query.result) { params.push(String(req.query.result).toUpperCase()); where.push(`result = $${params.length}`); }
    const limit = asLimit(req.query.limit);
    params.push(limit);
    const rows = (await query(
      `SELECT pass_id AS "passId", identity_value AS "identity", product_id AS "productId",
              work_order_code AS "workOrderCode", line_code AS "lineCode", station_code AS "stationCode",
              result, gate_state AS "gateState", reason_code AS "reasonCode", next_action AS "nextAction",
              visit_no AS "visitNo", retest_no AS "retestNo", operator_id AS "operatorId", source,
              defect_code AS "defectCode", skip_release_no AS "skipReleaseNo", decided_at AS "decidedAt"
         FROM mes_station_pass_events
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY decided_at DESC
        LIMIT $${params.length}`,
      params,
    )).rows;
    return res.json(listEnvelope(rows, rows.length));
  } catch (err) {
    console.error("GET /mes/station-pass/history:", err.message);
    return res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// ── 策略 ────────────────────────────────────────────────────────────────────
router.get("/policies", authenticateJWT, requirePermission("mes.view"), async (_req, res) => {
  try {
    const rows = (await query(
      `SELECT p.station_code AS "stationCode", s.status AS "stationStatus",
              p.deny_manual_pass AS "denyManualPass", p.allow_repeat_pass AS "allowRepeatPass",
              p.max_retest AS "maxRetest", p.min_dwell_minutes AS "minDwellMinutes",
              p.require_upstream_ok AS "requireUpstreamOk", p.notes, p.updated_by AS "updatedBy",
              p.updated_at AS "updatedAt"
         FROM mes_station_pass_policies p
         LEFT JOIN stations s ON lower(s.code) = lower(p.station_code)
        ORDER BY p.station_code`,
    )).rows;
    return res.json(listEnvelope(rows, rows.length));
  } catch (err) {
    console.error("GET /mes/station-pass/policies:", err.message);
    return res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

router.put("/policies/:stationCode", authenticateJWT, requirePermission("mes.admin"), async (req, res) => {
  try {
    const stationCode = String(req.params.stationCode || "").trim();
    const body = req.body?.payload ?? req.body ?? {};
    if (!stationCode) return res.status(400).json(errorEnvelope("VALIDATION", "stationCode required"));
    const rows = (await query(
      `INSERT INTO mes_station_pass_policies(station_code, deny_manual_pass, allow_repeat_pass,
         max_retest, min_dwell_minutes, require_upstream_ok, notes, updated_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (station_code) DO UPDATE SET
         deny_manual_pass = EXCLUDED.deny_manual_pass,
         allow_repeat_pass = EXCLUDED.allow_repeat_pass,
         max_retest = EXCLUDED.max_retest,
         min_dwell_minutes = EXCLUDED.min_dwell_minutes,
         require_upstream_ok = EXCLUDED.require_upstream_ok,
         notes = EXCLUDED.notes,
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()
       RETURNING station_code AS "stationCode", deny_manual_pass AS "denyManualPass",
         allow_repeat_pass AS "allowRepeatPass", max_retest AS "maxRetest",
         min_dwell_minutes AS "minDwellMinutes", require_upstream_ok AS "requireUpstreamOk",
         notes, updated_by AS "updatedBy", updated_at AS "updatedAt"`,
      [stationCode, body.denyManualPass === true, body.allowRepeatPass === true,
        Math.max(0, Number(body.maxRetest || 0)), Math.max(0, Number(body.minDwellMinutes || 0)),
        body.requireUpstreamOk !== false, body.notes ?? null, req.user?.username || "unknown"],
    )).rows[0];
    return res.json(envelope(rows));
  } catch (err) {
    console.error("PUT /mes/station-pass/policies:", err.message);
    return res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

// ── 跳站放行单 ──────────────────────────────────────────────────────────────
router.get("/skip-releases", authenticateJWT, requirePermission("mes.view"), async (req, res) => {
  try {
    const status = req.query.status ? String(req.query.status).toUpperCase() : null;
    const rows = (await query(
      `SELECT release_no AS "releaseNo", identity_value AS "identity", work_order_code AS "workOrderCode",
              from_station_code AS "fromStationCode", to_station_code AS "toStationCode", reason, status,
              requested_by AS "requestedBy", requested_at AS "requestedAt",
              approved_by AS "approvedBy", approved_at AS "approvedAt", reject_reason AS "rejectReason",
              consumed_at AS "consumedAt", expires_at AS "expiresAt"
         FROM mes_skip_releases
        ${status ? "WHERE status = $1" : ""}
        ORDER BY requested_at DESC LIMIT 200`,
      status ? [status] : [],
    )).rows;
    return res.json(listEnvelope(rows, rows.length));
  } catch (err) {
    console.error("GET /mes/station-pass/skip-releases:", err.message);
    return res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

router.post("/skip-releases", authenticateJWT, requirePermission("mes.execute"), async (req, res) => {
  try {
    const body = req.body?.payload ?? req.body ?? {};
    const identifier = String(body.identity || body.sn || "").trim().toUpperCase();
    const fromStationCode = String(body.fromStationCode || "").trim();
    const toStationCode = String(body.toStationCode || "").trim();
    const reason = String(body.reason || "").trim();
    if (!identifier || !fromStationCode || !toStationCode || !reason) {
      return res.status(400).json(errorEnvelope("VALIDATION",
        "identity, fromStationCode, toStationCode and reason are required"));
    }
    const releaseNo = `SKIP-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${randomUUID().slice(0, 6).toUpperCase()}`;
    const row = (await query(
      `INSERT INTO mes_skip_releases(release_no, identity_value, work_order_code, from_station_code,
         to_station_code, reason, requested_by, expires_at, detail)
       VALUES($1,$2,$3,$4,$5,$6,$7, now() + interval '8 hours', $8)
       RETURNING release_no AS "releaseNo", status, requested_at AS "requestedAt"`,
      [releaseNo, identifier, body.workOrderCode || null, fromStationCode, toStationCode, reason,
        req.user?.username || "unknown", JSON.stringify({ source: "web" })],
    )).rows[0];
    return res.status(201).json(envelope(row));
  } catch (err) {
    console.error("POST /mes/station-pass/skip-releases:", err.message);
    return res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

router.post("/skip-releases/:releaseNo/approve", authenticateJWT, requirePermission("mes.admin"), async (req, res) => {
  try {
    const row = (await query(
      `UPDATE mes_skip_releases
          SET status = 'APPROVED', approved_by = $2, approved_at = NOW()
        WHERE release_no = $1 AND status = 'PENDING'
        RETURNING release_no AS "releaseNo", status, approved_by AS "approvedBy", approved_at AS "approvedAt"`,
      [req.params.releaseNo, req.user?.username || "unknown"],
    )).rows[0];
    if (!row) return res.status(404).json(errorEnvelope("NOT_FOUND", "放行单不存在或已处理"));
    return res.json(envelope(row));
  } catch (err) {
    console.error("POST /mes/station-pass/skip-releases/approve:", err.message);
    return res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

router.post("/skip-releases/:releaseNo/reject", authenticateJWT, requirePermission("mes.admin"), async (req, res) => {
  try {
    const reason = String(req.body?.reason || req.body?.payload?.reason || "").trim() || null;
    const row = (await query(
      `UPDATE mes_skip_releases
          SET status = 'REJECTED', rejected_by = $2, rejected_at = NOW(), reject_reason = $3
        WHERE release_no = $1 AND status = 'PENDING'
        RETURNING release_no AS "releaseNo", status, rejected_by AS "rejectedBy", rejected_at AS "rejectedAt"`,
      [req.params.releaseNo, req.user?.username || "unknown", reason],
    )).rows[0];
    if (!row) return res.status(404).json(errorEnvelope("NOT_FOUND", "放行单不存在或已处理"));
    return res.json(envelope(row));
  } catch (err) {
    console.error("POST /mes/station-pass/skip-releases/reject:", err.message);
    return res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

return router;
}
