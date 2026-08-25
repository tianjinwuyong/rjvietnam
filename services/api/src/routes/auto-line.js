// ── Auto Line Dashboard API ────────────────────────────────────────
// GET /api/mes/auto-line/dashboard

import { Router } from "express";
import { query } from "../db.js";
import { envelope, errorEnvelope } from "../shared/helpers.js";

const router = Router();

router.get("/dashboard", async (req, res) => {
  try {
    const line = (await query(
      `SELECT id, internal_code AS code, name_zh, name_en, name_vi, status
       FROM production_lines WHERE internal_code = 'L002' LIMIT 1`
    )).rows[0];
    if (!line) return res.status(404).json(errorEnvelope("NOT_FOUND", "Auto line not found"));

    const stationStats = (await query(`
      SELECT
        s.id, s.code, s.name_zh, s.name_en, s.name_vi, s.status, s.equipment_code,
        st.code AS station_type,
        COUNT(se.id) FILTER (WHERE se.occurred_at > NOW() - INTERVAL '1 day') AS today_total,
        COUNT(se.id) FILTER (WHERE se.occurred_at > NOW() - INTERVAL '1 day' AND se.result = 'pass') AS today_pass,
        COUNT(se.id) FILTER (WHERE se.occurred_at > NOW() - INTERVAL '1 day' AND se.result = 'fail') AS today_fail,
        COUNT(se.id) FILTER (WHERE se.occurred_at > NOW() - INTERVAL '1 day' AND se.result = 'ng') AS today_ng,
        MAX(se.occurred_at) FILTER (WHERE se.occurred_at > NOW() - INTERVAL '1 day') AS last_event_at
      FROM stations s
      LEFT JOIN station_types st ON st.id = s.station_type_id
      LEFT JOIN station_events se ON se.station_id = s.id
      WHERE s.line_id = $1
      GROUP BY s.id, s.code, s.name_zh, s.name_en, s.name_vi, s.status, s.equipment_code, st.code
      ORDER BY s.sequence_order NULLS LAST, s.id
    `, [line.id])).rows;

    const todayTotals = (await query(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE result = 'pass') AS passed,
        COUNT(*) FILTER (WHERE result IN ('fail','ng')) AS failed
      FROM station_events se
      JOIN stations s ON s.id = se.station_id
      WHERE s.line_id = $1 AND se.occurred_at > NOW() - INTERVAL '1 day'
    `, [line.id])).rows[0];

    const recentEvents = (await query(`
      SELECT se.id, s.code AS station_code, s.name_zh AS station_name,
             se.event_type, se.result, se.occurred_at
      FROM station_events se
      JOIN stations s ON s.id = se.station_id
       WHERE s.line_id = $1
       ORDER BY se.occurred_at DESC LIMIT 20
    `, [line.id])).rows;

    res.json(envelope({
      line: {
        id: line.id,
        code: line.code,
        nameZh: line.name_zh,
        nameEn: line.name_en,
        nameVi: line.name_vi,
        status: line.status,
      },
      todayTotals: {
        total: parseInt(todayTotals?.total ?? 0),
        passed: parseInt(todayTotals?.passed ?? 0),
        failed: parseInt(todayTotals?.failed ?? 0),
        yield: todayTotals?.total > 0
          ? (((todayTotals.total - parseInt(todayTotals?.failed ?? 0)) / todayTotals.total) * 100).toFixed(1)
          : "100.0",
      },
      stations: stationStats.map(s => ({
        id: s.id,
        code: s.code,
        nameZh: s.name_zh,
        nameEn: s.name_en,
        nameVi: s.name_vi,
        status: s.status,
        stationType: s.station_type,
        equipmentCode: s.equipment_code,
        todayTotal: parseInt(s.today_total ?? 0),
        todayPass: parseInt(s.today_pass ?? 0),
        todayFail: parseInt(s.today_fail ?? 0),
        todayNg: parseInt(s.today_ng ?? 0),
        lastEventAt: s.last_event_at,
        passRate: s.today_total > 0
          ? Math.round((parseInt(s.today_pass ?? 0) / parseInt(s.today_total)) * 100)
          : 100,
      })),
      recentEvents: recentEvents.map(e => ({
        id: e.id,
        stationCode: e.station_code,
        stationName: e.station_name,
        eventType: e.event_type,
        result: e.result,
        occurredAt: e.occurred_at,
      })),
    }));
  } catch (err) {
    console.error("GET /mes/auto-line/dashboard:", err.message);
    res.status(500).json(errorEnvelope("SERVER_ERROR", err.message));
  }
});

export default router;
