// ── Manual Line 3D Dashboard API routes ────────────────────────────
// All under /api/mes/manual-line/ prefix (mounted in server.js)

import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { STATION_DATA_SOURCES, queryDirDs, queryMysqlDs, querySqlserverDs, queryExcelKpi, queryImportKpi, queryAoiKpi } from "../shared/station-data.js";
import { query } from "../db.js";
import { canonicalStationCode, canonicalStationId, CANONICAL_LINES } from "../shared/station-identity.js";

const router = Router();

const MANUAL_STATIONS = new Set([
  "manu_pda","manu_aio","manu_ict","manu_fct","manu_depanel","manu_shellbinding",
  "manu_assem_ate","manu_supersonic","manu_agingcab","manu_hivolt_ate",
  "manu_package_ate","manu_case_binding","manu_pallet_binding","manu_rework",
]);
const MANUAL_PROCESS = [
  {seq:1,code:"manu_pda",nameZh:"PDA扫码上料",input:"MATERIAL_QR",output:"WORK_ORDER_MATERIAL",source:"SCANNER",next:"manu_aio",receipt:false},
  {seq:2,code:"manu_aio",nameZh:"AOI质量工位",input:"PCB_SN",output:"PCB_SN",source:"MYSQL",next:"manu_ict",receipt:true},
  {seq:3,code:"manu_ict",nameZh:"ICT",input:"MOTHERBOARD_12",output:"MOTHERBOARD_12",source:"CSV",next:"manu_fct",receipt:true},
  {seq:4,code:"manu_fct",nameZh:"FCT",input:"MOTHERBOARD_12",output:"MOTHERBOARD_12",source:"EXCEL",next:"manu_depanel",receipt:true},
  {seq:5,code:"manu_depanel",nameZh:"PCBA分板工位",input:"MOTHERBOARD_12",output:"BOARD_SN",source:"SCANNER",next:"manu_shellbinding",receipt:true,identityTransition:"MOTHERBOARD_TO_12_BOARDS"},
  {seq:6,code:"manu_shellbinding",nameZh:"PCBA外壳绑码",input:"BOARD_SN+SHELL_SN",output:"BOUND_PRODUCT_SN",source:"SCANNER",next:"manu_assem_ate",receipt:true,identityTransition:"BOARD_TO_SHELL"},
  {seq:7,code:"manu_assem_ate",nameZh:"组装ATE",input:"BOUND_PRODUCT_SN",output:"BOUND_PRODUCT_SN",source:"REPORT_FILE",next:"manu_supersonic",receipt:true},
  {seq:8,code:"manu_supersonic",nameZh:"超声",input:"BOUND_PRODUCT_SN",output:"BOUND_PRODUCT_SN",source:"SQLSERVER",next:"manu_agingcab",receipt:true},
  {seq:9,code:"manu_agingcab",nameZh:"成品老化",input:"BOUND_PRODUCT_SN",output:"BOUND_PRODUCT_SN",source:"MYSQL",next:"manu_hivolt_ate",receipt:true},
  {seq:10,code:"manu_hivolt_ate",nameZh:"高压ATE",input:"BOUND_PRODUCT_SN",output:"BOUND_PRODUCT_SN",source:"REPORT_FILE",next:"manu_package_ate",receipt:true,retestExecution:"manu_agingcab"},
  {seq:11,code:"manu_package_ate",nameZh:"包装ATE",input:"BOUND_PRODUCT_SN",output:"PRODUCT_SN",source:"REPORT_FILE",next:"manu_case_binding",receipt:true,retestExecution:"manu_agingcab"},
  {seq:12,code:"manu_case_binding",nameZh:"外箱码绑定",input:"PRODUCT_SN+CARTON_QR",output:"CARTON_QR",source:"SCANNER",next:"manu_pallet_binding",receipt:true,identityTransition:"PRODUCTS_TO_CARTON"},
  {seq:13,code:"manu_pallet_binding",nameZh:"栈板绑码",input:"CARTON_QR+PALLET_QR",output:"PALLET_QR",source:"SCANNER",next:null,receipt:true,identityTransition:"CARTONS_TO_PALLET"},
];
const RESULT_ALIASES = new Map([
  ["OK","PASS"],["GOOD","PASS"],["1","PASS"],["TRUE","PASS"],
  ["NG","FAIL"],["NOK","FAIL"],["BAD","FAIL"],["0","FAIL"],["FALSE","FAIL"],
]);

function cleanStationRecord(input = {}) {
  const stationCode = canonicalStationCode(input.stationCode, CANONICAL_LINES.MANUAL);
  const sn = String(input.sn || input.serialNumber || input.pcbSerial || "").trim().toUpperCase();
  const rawResult = String(input.result || "READ").trim().toUpperCase();
  const result = RESULT_ALIASES.get(rawResult) || rawResult;
  const sourceTime = input.testTime || input.testedAt || input.timestamp || Date.now();
  const parsedTime = new Date(typeof sourceTime === "number" && sourceTime < 1e12 ? sourceTime * 1000 : sourceTime);
  const errors = [];
  if (!MANUAL_STATIONS.has(stationCode)) errors.push("UNKNOWN_STATION");
  if (!sn || sn.length < 6 || sn.length > 200 || !/^[A-Z0-9._\-()]+$/.test(sn)) errors.push("INVALID_SN");
  if (!new Set(["READ","PASS","FAIL","BLOCKED"]).has(result)) errors.push("INVALID_RESULT");
  if (Number.isNaN(parsedTime.getTime())) errors.push("INVALID_SOURCE_TIME");
  return {
    errors,
    normalized: {
      ...input,
      stationCode,
      sn,
      result,
      sourceTimeIso: Number.isNaN(parsedTime.getTime()) ? null : parsedTime.toISOString(),
    },
  };
}

router.get("/process-map", (_req, res) => {
  res.json({
    ok:true,
    lineCode:"004-MANUAL",
    identityFlow:["MATERIAL_QR","MOTHERBOARD_12","BOARD_SN","SHELL_SN","BOUND_PRODUCT_SN","CARTON_QR","PALLET_QR"],
    networkDisasterPolicy:{graceSeconds:30,warningSeconds:300,disasterSeconds:1200,
      disasterActions:["KEEP_LOCAL_CAPTURE","STOP_PRODUCT_HANDOVER","KEEP_DUP_NG_GUARDS","PRESERVE_SOURCE_FILES","ORDERED_REPLAY","HASH_RECONCILIATION"]},
    stations:MANUAL_PROCESS.map((station,index)=>({
      ...station, canonicalId:canonicalStationId(CANONICAL_LINES.MANUAL, station.code),
      previous:index ? MANUAL_PROCESS[index-1].code : null,
      exceptionRoutes:["manu_rework","SCRAP_APPROVAL"],
      requiredControls:["DUP_GUARD","NG_GUARD","WORK_ORDER_BINDING","ENTRY_EXIT_TIME","OFFLINE_OUTBOX"],
    })),
  });
});

router.get("/continuity-gaps", async (req, res) => {
  try {
    const handoverMinutes = Math.max(1,Number(req.query.handoverMinutes || 2));
    const residenceMinutes = Math.max(1,Number(req.query.residenceMinutes || 30));
    const [handovers,relay,residence,quarantine,heartbeats] = await Promise.all([
      query(`SELECT transfer_id AS "transferId",batch_id AS "batchId",source_station AS "sourceStation",
        destination_station AS "destinationStation",destination_type AS "destinationType",sent_at AS "openedAt",
        EXTRACT(EPOCH FROM (NOW()-sent_at))::int AS "ageSeconds"
        FROM station_handover_transfers WHERE status='WAITING_RECEIPT'
        AND sent_at<NOW()-($1::text||' minutes')::interval ORDER BY sent_at DESC LIMIT 500`,[handoverMinutes]),
      query(`SELECT * FROM (
        (SELECT staging_id AS "stagingId",event_id AS "eventId",station_code AS "stationCode",status,
          received_at AS "openedAt",error_code AS "errorCode",error_detail AS "errorDetail"
          FROM station_data_staging WHERE status='CLEANED'
          AND received_at<NOW()-INTERVAL '2 minutes' ORDER BY received_at DESC LIMIT 250)
        UNION ALL
        (SELECT staging_id AS "stagingId",event_id AS "eventId",station_code AS "stationCode",status,
          received_at AS "openedAt",error_code AS "errorCode",error_detail AS "errorDetail"
          FROM station_data_staging WHERE status='FAILED'
          AND received_at<NOW()-INTERVAL '2 minutes' ORDER BY received_at DESC LIMIT 250)
        ) pending ORDER BY "openedAt" DESC LIMIT 500`),
      query(`SELECT residence_id AS "residenceId",station_code AS "stationCode",sn,batch_id AS "batchId",
        entered_at AS "openedAt",EXTRACT(EPOCH FROM (NOW()-entered_at))::int AS "ageSeconds"
        FROM station_product_residence WHERE exited_at IS NULL
        AND entered_at<NOW()-($1::text||' minutes')::interval ORDER BY entered_at DESC LIMIT 500`,[residenceMinutes]),
      query(`SELECT quarantine_id AS "quarantineId",event_id AS "eventId",station_code AS "stationCode",
        reason_code AS "reasonCode",quarantined_at AS "openedAt" FROM station_data_quarantine
        WHERE status='OPEN' ORDER BY quarantined_at DESC LIMIT 500`),
      query(`SELECT station_code AS "stationCode",last_seen AS "lastSeen"
        FROM station_heartbeats WHERE station_code=ANY($1::text[])`,[[...MANUAL_STATIONS]]),
    ]);
    const heartbeatMap=new Map(heartbeats.rows.map(row=>[row.stationCode,new Date(row.lastSeen).getTime()]));
    const now=Date.now();
    const offline=MANUAL_PROCESS.filter(s=>s.code!=="manu_pda").map(s=>{
      const last=heartbeatMap.get(s.code)||0;const offlineSeconds=last?Math.floor((now-last)/1000):null;
      const level=!last||offlineSeconds>=1200?'DISASTER':offlineSeconds>=300?'HIGH':offlineSeconds>=30?'WARNING':'ONLINE';
      return {stationCode:s.code,lastSeen:last?new Date(last).toISOString():null,offlineSeconds,level,
        handoverBlocked:level==='DISASTER'};
    }).filter(s=>s.level!=='ONLINE');
    const gaps=[
      ...handovers.rows.map(x=>({type:"HANDOVER_NOT_RECEIVED",severity:"CRITICAL",...x})),
      ...relay.rows.map(x=>({type:"DATA_NOT_PROJECTED",severity:"CRITICAL",...x})),
      ...residence.rows.map(x=>({type:"STATION_RESIDENCE_OVERDUE",severity:"WARNING",...x})),
      ...quarantine.rows.map(x=>({type:"QUARANTINE_UNRESOLVED",severity:"WARNING",...x})),
      ...offline.map(x=>({type:x.level==='DISASTER'?"NETWORK_DISASTER":"STATION_OFFLINE",
        severity:x.level==='DISASTER'?'CRITICAL':x.level==='HIGH'?'CRITICAL':'WARNING',...x})),
    ];
    res.json({ok:true,checkedAt:new Date().toISOString(),thresholds:{handoverMinutes,residenceMinutes,
      network:{graceSeconds:30,highSeconds:300,disasterSeconds:1200}},
      summary:{total:gaps.length,critical:gaps.filter(x=>x.severity==='CRITICAL').length,
        warning:gaps.filter(x=>x.severity==='WARNING').length},gaps});
  } catch (error) { res.status(500).json({ok:false,error:String(error?.message || error)}); }
});

// Unified relay entry: raw source data is persisted before cleansing. Invalid
// records are quarantined instead of disappearing or polluting production data.
router.post("/data-relay", async (req, res) => {
  try {
    const raw = req.body?.payload ?? req.body ?? {};
    const stationCode = canonicalStationCode(raw.stationCode || req.body?.stationCode, CANONICAL_LINES.MANUAL);
    const eventId = String(req.body?.eventId || raw.eventId || randomUUID()).slice(0, 160);
    const sourceType = String(req.body?.sourceType || raw.sourceType || "station_agent").trim().toLowerCase();
    const sourceRef = String(req.body?.sourceRef || raw.sourceFile || "").trim() || null;
    const stableRaw = JSON.stringify(raw);
    const hash = createHash("sha256").update(stableRaw).digest("hex");
    const inserted = await query(`INSERT INTO station_data_staging
      (event_id,station_code,source_type,source_ref,raw_payload,payload_hash)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(event_id) DO UPDATE SET event_id=EXCLUDED.event_id
      RETURNING staging_id AS "stagingId",status`,
      [eventId,stationCode || "unknown",sourceType,sourceRef,stableRaw,hash]);
    const { errors, normalized } = cleanStationRecord({...raw, stationCode});
    if (errors.length) {
      await query(`UPDATE station_data_staging SET status='QUARANTINED',processed_at=NOW(),error_code=$2,
        error_detail=$3 WHERE event_id=$1`,[eventId,errors[0],errors.join(",")]);
      await query(`INSERT INTO station_data_quarantine
        (staging_id,event_id,station_code,reason_code,reason_detail,raw_payload)
        VALUES($1,$2,$3,$4,$5,$6)`,[inserted.rows[0].stagingId,eventId,stationCode||"unknown",errors[0],errors.join(","),stableRaw]);
      return res.status(422).json({ok:false,quarantined:true,eventId,errors});
    }
    await query(`UPDATE station_data_staging SET status='CLEANED',normalized_payload=$2,processed_at=NOW()
      WHERE event_id=$1`,[eventId,JSON.stringify(normalized)]);
    const eventType = String(req.body?.eventType || raw.eventType ||
      (sourceType === "scanner" ? "SCAN_GUARD_CHECK" : "SN_SCAN")).trim().toUpperCase();
    const apiPort = Number(process.env.PORT || 8080);
    let projection;
    try {
      const forwarded = await fetch(`http://127.0.0.1:${apiPort}/api/pda/events`, {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({
          eventId,
          from: `data_relay:${sourceType}`,
          to: "mes_server",
          type: eventType,
          stationCode,
          payload: {...normalized, sourceType, sourceRef, testTime: normalized.sourceTimeIso},
        }),
        signal: AbortSignal.timeout(15000),
      });
      const body = await forwarded.json().catch(() => ({}));
      projection = {httpStatus:forwarded.status,...body};
      if (!forwarded.ok) throw new Error(body?.error?.message || body?.code || `projection HTTP ${forwarded.status}`);
      await query(`UPDATE station_data_staging SET status='PROJECTED',processed_at=NOW(),error_code=NULL,error_detail=NULL
        WHERE event_id=$1`,[eventId]);
    } catch (projectionError) {
      await query(`UPDATE station_data_staging SET status='FAILED',processed_at=NOW(),error_code='PROJECTION_FAILED',error_detail=$2
        WHERE event_id=$1`,[eventId,String(projectionError?.message || projectionError)]);
      return res.status(503).json({ok:false,eventId,stagingId:inserted.rows[0].stagingId,status:"FAILED",
        retryable:true,error:String(projectionError?.message || projectionError),projection});
    }
    res.status(202).json({ok:true,eventId,stagingId:inserted.rows[0].stagingId,status:"PROJECTED",
      payload:normalized,projection});
  } catch (error) {
    res.status(500).json({ok:false,error:String(error?.message || error)});
  }
});

router.get("/data-lifecycle", async (_req, res) => {
  try {
    const [staging,quarantine,policies,cleanup] = await Promise.all([
      query(`SELECT status,COUNT(*)::int count,MIN(received_at) AS oldest,MAX(received_at) AS newest
        FROM station_data_staging GROUP BY status ORDER BY status`),
      query(`SELECT status,COUNT(*)::int count,MIN(quarantined_at) AS oldest
        FROM station_data_quarantine GROUP BY status ORDER BY status`),
      query(`SELECT dataset,retention_days AS "retentionDays",archive_before_delete AS "archiveBeforeDelete",
        enabled,protected,description FROM station_data_retention_policies ORDER BY dataset`),
      query(`SELECT dataset,cutoff_at AS "cutoffAt",rows_deleted AS "rowsDeleted",dry_run AS "dryRun",
        executed_by AS "executedBy",executed_at AS "executedAt" FROM station_data_cleanup_audit
        ORDER BY executed_at DESC LIMIT 50`),
    ]);
    res.json({ok:true,staging:staging.rows,quarantine:quarantine.rows,policies:policies.rows,cleanup:cleanup.rows});
  } catch (error) { res.status(500).json({ok:false,error:String(error?.message || error)}); }
});

// Safe cleanup defaults to preview. Only explicitly allow-listed, rebuildable
// datasets can be deleted; quality and audit ledgers can never enter this path.
router.post("/data-lifecycle/cleanup", async (req, res) => {
  try {
    const dryRun = req.body?.dryRun !== false;
    const actor = String(req.body?.actor || "MES_DATA_LIFECYCLE").trim();
    const allowed = new Map([
      ["station_data_staging_projected", {table:"station_data_staging", time:"received_at", where:"status='PROJECTED'"}],
      ["station_data_staging_failed", {table:"station_data_staging", time:"received_at", where:"status='FAILED'"}],
      ["station_data_quarantine_closed", {table:"station_data_quarantine", time:"quarantined_at", where:"status IN ('RELEASED','DISCARDED')"}],
      ["station_inventory_checks", {table:"station_inventory_checks", time:"checked_at", where:"TRUE"}],
    ]);
    const requested = req.body?.dataset ? [String(req.body.dataset)] : [...allowed.keys()];
    const results = [];
    for (const dataset of requested) {
      const target = allowed.get(dataset);
      if (!target) { results.push({dataset,skipped:true,reason:"PROTECTED_OR_UNKNOWN"}); continue; }
      const policy = (await query(`SELECT retention_days,enabled,protected FROM station_data_retention_policies WHERE dataset=$1`,[dataset])).rows[0];
      if (!policy?.enabled || policy.protected) { results.push({dataset,skipped:true,reason:"POLICY_DISABLED_OR_PROTECTED"}); continue; }
      const cutoff = new Date(Date.now()-Number(policy.retention_days)*86400000);
      const count = await query(`SELECT COUNT(*)::int count FROM ${target.table} WHERE ${target.where} AND ${target.time}<$1`,[cutoff]);
      let deleted = 0;
      if (!dryRun && Number(count.rows[0].count)>0) {
        const result = await query(`DELETE FROM ${target.table} WHERE ${target.where} AND ${target.time}<$1`,[cutoff]);
        deleted = Number(result.rows?.length || count.rows[0].count);
      }
      await query(`INSERT INTO station_data_cleanup_audit(dataset,cutoff_at,rows_deleted,dry_run,executed_by,detail)
        VALUES($1,$2,$3,$4,$5,$6)`,[dataset,cutoff,deleted,dryRun,actor,JSON.stringify({eligible:Number(count.rows[0].count)})]);
      results.push({dataset,dryRun,eligible:Number(count.rows[0].count),deleted,cutoff});
    }
    res.json({ok:true,dryRun,results});
  } catch (error) { res.status(500).json({ok:false,error:String(error?.message || error)}); }
});

// ── Scanner snapshots ─────────────────────────────────────────────
// Removed legacy scanner-snapshots API: station heartbeats and the event ledger
// are the single real-time source used by MES and 3D.

// ── Station stats from CSV files ─────────────────────────────────
// Removed legacy station-stats API: station-kpi is the canonical endpoint.

// ── Launch all station executables ──────────────────────────────
router.post("/start-stations", async (req, res) => {
  const { stations, folder } = req.body || {};
  try {
    if (stations && Array.isArray(stations)) {
      const results = [];
      await Promise.allSettled(stations.map(async (s) => {
        if (!s.ip || !s.exe) return;
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 5000);
          const port = s.port || 8089;
          const r = await fetch(`http://${s.ip}:${port}/start`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ exe: s.exe }),
            signal: controller.signal,
          });
          clearTimeout(timeout);
          const data = await r.json();
          results.push({ ip: s.ip, exe: s.exe, ok: data.started, pid: data.pid, error: data.error });
        } catch (e) {
          results.push({ ip: s.ip, exe: s.exe, ok: false, error: String(e) });
        }
      }));
      const started = results.filter(r => r.ok).map(r => r.exe);
      const failed = results.filter(r => !r.ok);
      res.json({ started, failed, total: stations.length, details: results });
    } else {
      const targetFolder = folder || "D:/stations";
      if (!fs.existsSync(targetFolder)) {
        return res.status(404).json({ error: `Folder not found: ${targetFolder}` });
      }
      const files = fs.readdirSync(targetFolder).filter(f => f.toLowerCase().endsWith(".exe"));
      const started = [];
      const failed = [];
      for (const file of files) {
        const fullPath = path.join(targetFolder, file);
        try {
          const child = spawn("cmd.exe", ["/c", "start", "", fullPath], {
            detached: true,
            stdio: "ignore",
            windowsHide: true,
          });
          child.unref();
          started.push(file);
        } catch (e) {
          failed.push({ file, reason: String(e) });
        }
      }
      res.json({ started, failed, total: files.length });
    }
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── Stop station executables ─────────────────────────────────────
router.post("/stop-stations", async (req, res) => {
  const { stations } = req.body || {};
  if (!stations || !Array.isArray(stations)) {
    return res.status(400).json({ error: "stations array required" });
  }
  const results = [];
  await Promise.allSettled(stations.map(async (s) => {
    if (!s.ip || !s.exe) return;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const port = s.port || 8089;
      const r = await fetch(`http://${s.ip}:${port}/stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exe: s.exe }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const data = await r.json();
      results.push({ ip: s.ip, exe: s.exe, ok: data.stopped, error: data.error });
    } catch (e) {
      results.push({ ip: s.ip, exe: s.exe, ok: false, error: String(e) });
    }
  }));
  const stopped = results.filter(r => r.ok).map(r => r.exe);
  const failed = results.filter(r => !r.ok);
  res.json({ stopped, failed, total: stations.length, details: results });
});

// ── Station KPI ─────────────────────────────────────────────────
router.get("/station-kpi/:code", async (req, res) => {
  const code = req.params.code;
  const cfg = STATION_DATA_SOURCES[code];
  if (!cfg) return res.status(404).json({ error: `Unknown station: ${code}` });
  try {
    let result;
    if (code === 'manu_aio') {
      result = await queryAoiKpi(cfg);
    } else if (code === 'manu_ict') {
      result = await queryImportKpi(cfg, ['txt', 'ict']);
    } else if (code === 'manu_fct') {
      result = await queryImportKpi(cfg, ['csv', 'fct']);
    } else if (cfg.type === 'excel' || code === 'manu_assem_ate' || code === 'manu_hivolt_ate' || code === 'manu_package_ate' || code === 'manu_agingcab') {
      result = await queryExcelKpi({ ...cfg, code });
    } else if (cfg.type === 'dir') {
      result = await queryDirDs(cfg);
      result.stats = null;
    } else {
      return res.json({ stationCode: code, sourceType: cfg.type || 'unknown', stats: null, ng_pool: [], defects: [], trend: [], note: cfg.note || 'Not configured' });
    }
    res.json({ stationCode: code, ...result });
  } catch (err) {
    res.status(503).json({ stationCode: code, sourceType: cfg.type, stats: null, ng_pool: [], defects: [], trend: [], error: String(err) });
  }
});

// ── Station data source ─────────────────────────────────────────
router.get("/station-data/:code", async (req, res) => {
  const cfg = STATION_DATA_SOURCES[req.params.code];
  if (!cfg) return res.status(404).json({ error: `Unknown station code: ${req.params.code}` });
  try {
    let result;
    if (cfg.type === "mysql")       result = await queryMysqlDs(cfg);
    else if (cfg.type === "sqlserver") result = await querySqlserverDs(cfg);
    else if (cfg.type === "dir")    result = await queryDirDs(cfg);
    else                            result = { sourceType: "unknown", note: cfg.note ?? "Not configured" };
    // A reachable host is not the same as a usable station data source.  Directory
    // readers return a structured `error` so the 3D twin can show DEGRADED instead
    // of allowing the MES line-level `running` flag to mask a source failure.
    const connected = !result?.error;
    res.json({ connected, sourceStatus: connected ? "LIVE" : "DEGRADED", ...result });
  } catch (err) {
    res.status(503).json({ connected: false, sourceType: cfg.type, error: `${cfg.label} unreachable: ${err instanceof Error ? err.message : err}` });
  }
});

export default router;
