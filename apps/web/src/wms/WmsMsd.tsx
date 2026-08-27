import { useState, useEffect, useMemo, useCallback } from "react";
import {
  AlertTriangle, Clock, Thermometer, Package, Search, ShieldAlert,
  Scan, X, CheckCircle, Zap, Flame, TrendingDown, Lock, Unlock,
  ChevronDown, ChevronRight, RotateCcw, Printer
} from "lucide-react";
import { t } from "../i18n";
import { wmsApi } from "../api/wms";
import type { LifecycleAlertAction } from "../api/wms";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import QRCode from "qrcode";
import { MsMoistureControlDiagram } from "./MsMoistureControlDiagram";
import { MsLabelPrintingPage } from "./MsLabelPrintingPage";
import { MsPdaSyncPage } from "./MsPdaSyncPage";

// MSD Level 标准参照表 (IPC/JEDEC J-STD-033)
const MSD_LEVELS: { level: string; floorLife: string; note: string; color: string }[] = [
  { level: "1",    floorLife: "无限制",  note: "< 30℃ / 85%RH",    color: "#22c55e" },
  { level: "2",    floorLife: "4 周",     note: "< 30℃ / 60%RH",    color: "#3b82f6" },
  { level: "2a",   floorLife: "168 小时", note: "< 30℃ / 60%RH",   color: "#f59e0b" },
  { level: "3",    floorLife: "48 小时",  note: "< 30℃ / 60%RH",   color: "#ef4444" },
  { level: "4",    floorLife: "24 小时",  note: "< 30℃ / 60%RH",   color: "#dc2626" },
  { level: "5",    floorLife: "24 小时",  note: "< 30℃ / 60%RH",   color: "#b91c1c" },
  { level: "5a",   floorLife: "6 小时",   note: "< 30℃ / 60%RH",   color: "#991b1b" },
  { level: "6",    floorLife: "按标签",   note: "< 30℃ / 60%RH",   color: "#7f1d1d" },
];

interface OpenedLot {
  id: number; lot_no: string; opened_at: string; opened_shelf_life_days: number;
  received_at?: string; fifo_rank?: number; life_tracking_id?: number; work_order_codes?: string[]; opened_qty?: number; remaining_qty?: number;
  serial_no?: string; sn?: string;
  closed_at?: string | null; closed_by?: string | null;
  received_qty: number; material_code: string; name_zh: string; location_code: string;
  remaining_days_after_opened: number;
  baking_required?: boolean; baking_started_at?: string; baking_completed_at?: string;
  baking_temperature?: number; baking_result?: string;
}

interface SealedLot {
  id: number; lotNo: string; materialCode: string; nameZh: string; qty: number;
  locationCode: string; msdLevel: string; shelfLifeDays: number; iqcStatus: string;
}

interface BakingRecord {
  id: number; lot_no: string; material_code: string; name_zh: string;
  operator_name: string | null; started_at: string; completed_at: string | null;
  temperature: number | null; humidity: number | null; oven_no: string | null;
  result: "pass" | "fail" | "pending" | null; notes: string | null;
}

const API = "/api";
const MSD_WARNING_HOURS = 30 * 24;

function fmtDt(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function fmtHours(h: number): string {
  if (!isFinite(h) || h < 0) return "—";
  if (h < 1) return Math.round(h * 60) + "m";
  const days = Math.floor(h / 24);
  const hours = Math.floor(h % 24);
  if (days > 0) return `${days}d ${hours}h`;
  return `${hours}h`;
}

function calcRemainingHours(openedShelfLifeDays: number, openedAt: string): number {
  return openedShelfLifeDays * 24 - (Date.now() - new Date(openedAt).getTime()) / 3_600_000;
}

function calcProdCountdown(openedShelfLifeDays: number, openedAt: string, prodStart: string): number {
  if (!prodStart) return NaN;
  const effectiveStartMs = new Date(prodStart).getTime() - 10 * 60_000;
  const nowMs = Date.now();
  if (nowMs < effectiveStartMs) return openedShelfLifeDays * 24;
  return Math.max(0, openedShelfLifeDays * 24 - (nowMs - effectiveStartMs) / 3_600_000);
}

function lifeColor(h: number): string {
  if (!isFinite(h) || h > 168) return "var(--ok)";
  if (h <= 0) return "var(--danger)";
  if (h <= 24) return "var(--danger)";
  return "#f59e0b";
}

function prodColor(h: number): string {
  if (!isFinite(h)) return "var(--muted)";
  if (h <= 0) return "var(--danger)";
  if (h <= 2) return "var(--danger)";
  if (h <= 8) return "#f59e0b";
  return "var(--ok)";
}

function printRemainingInfo(lot: OpenedLot, remainingHours: number, productionHours: number): void {
  const printWindow = window.open("", "_blank", "width=760,height=640");
  if (!printWindow) return;
  const remaining = remainingHours <= 0 ? "EXPIRED" : fmtHours(remainingHours);
  const production = isFinite(productionHours) ? (productionHours <= 0 ? "EXPIRED" : fmtHours(productionHours)) : "-";
  printWindow.document.write(`<!doctype html><html><head><title>MSD Remaining Life - ${lot.lot_no}</title><style>
    body{font-family:Arial,sans-serif;padding:28px;color:#111}h1{font-size:20px;margin:0 0 20px}table{border-collapse:collapse;width:100%}td{border:1px solid #bbb;padding:10px}td:first-child{font-weight:700;width:34%;background:#f3f4f6}.foot{margin-top:22px;font-size:12px;color:#555}
  </style></head><body><h1>MSD Material Remaining-Life Information</h1><table>
    <tr><td>Material Code</td><td>${lot.material_code}</td></tr>
    <tr><td>Material Name</td><td>${lot.name_zh || "-"}</td></tr>
    <tr><td>Lot No.</td><td>${lot.lot_no}</td></tr>
    <tr><td>Opened At</td><td>${fmtDt(lot.opened_at)}</td></tr>
    <tr><td>Floor Life</td><td>${lot.opened_shelf_life_days} days</td></tr>
    <tr><td>Exposed Time</td><td>${fmtHours(lot.opened_shelf_life_days * 24 - remainingHours)}</td></tr>
    <tr><td>Remaining Floor Life</td><td><strong>${remaining}</strong></td></tr>
    <tr><td>Production Countdown</td><td>${production}</td></tr>
    <tr><td>Location</td><td>${lot.location_code || "-"}</td></tr>
  </table><div class="foot">Printed at ${new Date().toLocaleString()}</div></body></html>`);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}

async function printMaterialLabel(lot: OpenedLot, remainingHours: number): Promise<void> {
  const code = lot.lot_no;
  const qr = await QRCode.toDataURL(code, { width: 220, margin: 1, errorCorrectionLevel: "M" });
  const printWindow = window.open("", "_blank", "width=520,height=620");
  if (!printWindow) return;
  printWindow.document.write(`<html><head><title>Material label ${code}</title><style>body{font-family:Arial,sans-serif;margin:18px;color:#172033}.label{width:360px;border:1px solid #172033;padding:14px}.qr{text-align:center}.qr img{width:180px;height:180px}.code{font-family:monospace;font-size:20px;font-weight:700;letter-spacing:1px;word-break:break-all;border-top:1px solid #cbd5e1;padding-top:8px;margin-top:8px}.row{display:flex;justify-content:space-between;border-bottom:1px solid #e5e7eb;padding:5px 0;font-size:12px}.title{font-size:16px;font-weight:700;margin-bottom:8px}</style></head><body><div class="label"><div class="title">MSD MATERIAL LABEL</div><div class="qr"><img src="${qr}" /></div><div class="code">${code}</div><div class="row"><span>Material</span><b>${lot.material_code}</b></div><div class="row"><span>Lot</span><b>${lot.lot_no}</b></div><div class="row"><span>MSD floor life</span><b>${lot.opened_shelf_life_days} days</b></div><div class="row"><span>Opened at</span><b>${fmtDt(lot.opened_at)}</b></div><div class="row"><span>Sealed at</span><b>${lot.closed_at ? fmtDt(lot.closed_at) : "OPEN"}</b></div><div class="row"><span>Remaining</span><b>${lot.closed_at ? "SEALED" : fmtHours(remainingHours)}</b></div></div><script>window.onload=()=>window.print()</script></body></html>`);
  printWindow.document.close();
}

export function WmsMsd({ locale, initialTab = "opened" }: { locale: Locale; initialTab?: "opened" | "sealed" | "baking" | "label" | "pdaSync" }) {
  const [openings, setOpenings] = useState<OpenedLot[]>([]);
  const [sealedLots, setSealedLots] = useState<SealedLot[]>([]);
  const [bakingRecords, setBakingRecords] = useState<BakingRecord[]>([]);
  const [alerts, setAlerts] = useState<LifecycleAlertAction[]>([]);
  const [loadingOpenings, setLoadingOpenings] = useState(false);
  const [loadingSealed, setLoadingSealed] = useState(false);
  const [loadingBaking, setLoadingBaking] = useState(false);
  const [err, setErr] = useState("");
  const [searchQ, setSearchQ] = useState("");
  const [materialQuery, setMaterialQuery] = useState("");
  const [submittedMaterialQuery, setSubmittedMaterialQuery] = useState("");
  const [warningOnly, setWarningOnly] = useState(false);
  const [tab, setTab] = useState<"opened" | "sealed" | "baking" | "label" | "pdaSync">(initialTab);

  // 开箱 Modal
  const [showOpenModal, setShowOpenModal] = useState(false);
  const [openLotNo, setOpenLotNo] = useState("");
  const [openWorkOrderCodes, setOpenWorkOrderCodes] = useState("");
  const [openShelfLifeDays, setOpenShelfLifeDays] = useState("");
  const [openShelfLifeHours, setOpenShelfLifeHours] = useState("0");
  const [opening, setOpening] = useState(false);
  const [openOk, setOpenOk] = useState(false);
  const [sealing, setSealing] = useState<number | null>(null);

  // 产前起始时间
  const [prodStart, setProdStart] = useState<string>(() => {
    const d = new Date(); d.setHours(10, 0, 0, 0);
    if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 16);
  });

  // 烘烤 Modal
  const [showBakeModal, setShowBakeModal] = useState(false);
  const [bakingLot, setBakingLot] = useState<OpenedLot | null>(null);
  const [bakeTemp, setBakeTemp] = useState("125");
  const [bakeHumidity, setBakeHumidity] = useState("");
  const [bakeOven, setBakeOven] = useState("");
  const [bakeOperator, setBakeOperator] = useState("");
  const [bakeNotes, setBakeNotes] = useState("");
  const [bakingIn, setBakingIn] = useState(false);
  const [bakeSuccess, setBakeSuccess] = useState(false);

  // 完成烘烤 Modal
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [completeRecord, setCompleteRecord] = useState<BakingRecord | null>(null);
  const [completeResult, setCompleteResult] = useState<"pass" | "fail">("pass");
  const [completeNotes, setCompleteNotes] = useState("");
  const [completing, setCompleting] = useState(false);

  // MSD等级参照展开
  const [levelExpanded, setLevelExpanded] = useState(true);

  const fetchOpenings = useCallback(async () => {
    setLoadingOpenings(true);
    try {
      const j = await (await fetch(API + "/lifecycle/openings")).json();
      setOpenings(j.items || []);
      setErr("");
    } catch (e: any) { setErr(e.message); }
    finally { setLoadingOpenings(false); }
  }, []);

  const fetchSealed = useCallback(async () => {
    setLoadingSealed(true);
    try {
      const j = await (await fetch(API + "/wms/material-lots?limit=200&offset=0")).json();
      setSealedLots((j.items || []).filter((lot: any) => !lot.openedAt && lot.msdLevel));
    } catch (e: any) { setErr(e.message); }
    finally { setLoadingSealed(false); }
  }, []);

  const fetchBaking = useCallback(async () => {
    setLoadingBaking(true);
    try {
      const j = await (await fetch(API + "/lifecycle/baking")).json();
      setBakingRecords(j.items || []);
    } catch (e: any) { setErr(e.message); }
    finally { setLoadingBaking(false); }
  }, []);

  useEffect(() => { fetchOpenings(); }, [fetchOpenings]);
  useEffect(() => {
    let active = true;
    const loadAlerts = async () => { try { const rows = await wmsApi.getLifecycleAlertsWithActions(); if (active) setAlerts(rows ?? []); } catch { /* dashboard remains usable when alert service is unavailable */ } };
    void loadAlerts();
    const timer = window.setInterval(loadAlerts, 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  useEffect(() => {
    if (tab === "sealed") fetchSealed();
    else if (tab === "baking") fetchBaking();
  }, [tab, fetchSealed, fetchBaking]);

  async function handleOpen() {
    if (!openLotNo.trim() || !openWorkOrderCodes.trim()) { setErr("开箱必须绑定至少一个工单/订单号"); return; }
    setOpening(true);
    try {
      const workOrderCodes = Array.from(new Set(openWorkOrderCodes.split(/[,，\s]+/).map(x => x.trim()).filter(Boolean)));
      const body: any = { lotNo: openLotNo.trim(), workOrderCodes };
      if (openShelfLifeDays !== "") {
        const days = Number(openShelfLifeDays);
        const hours = Number(openShelfLifeHours || 0);
        if (!Number.isFinite(days) || !Number.isFinite(hours) || days < 0 || hours < 0 || hours >= 24) throw new Error("Floor life must use 0-23 hours and non-negative days");
        body.openedShelfLifeDays = days + hours / 24;
      }
      const r = await fetch(API + "/lifecycle/openings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message || j.error || "Failed");
      setOpenOk(true);
      setOpenLotNo(""); setOpenWorkOrderCodes(""); setOpenShelfLifeDays(""); setOpenShelfLifeHours("0");
      setTimeout(() => { setShowOpenModal(false); setOpenOk(false); fetchOpenings(); setTab("opened"); }, 1200);
    } catch (e: any) { setErr(e.message); }
    finally { setOpening(false); }
  }

  async function handleSeal(lot: OpenedLot) {
    if (!lot.id || lot.closed_at) return;
    setSealing(lot.id);
    try { await wmsApi.sealLifecycleOpening(lot.id, "WMS_OPERATOR"); await fetchOpenings(); }
    catch (e: any) { setErr(e.message); }
    finally { setSealing(null); }
  }

  async function handleStartBake() {
    if (!bakingLot) return;
    setBakingIn(true);
    try {
      const body: any = { lotNo: bakingLot.lot_no };
      if (bakeTemp) body.temperature = parseFloat(bakeTemp);
      if (bakeHumidity) body.humidity = parseFloat(bakeHumidity);
      if (bakeOven) body.ovenNo = bakeOven;
      if (bakeOperator) body.operatorName = bakeOperator;
      if (bakeNotes) body.notes = bakeNotes;
      const r = await fetch(API + "/lifecycle/baking", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message || j.error || "Failed");
      setBakeSuccess(true);
      setTimeout(() => { setShowBakeModal(false); setBakeSuccess(false); setBakingLot(null); fetchOpenings(); fetchBaking(); setTab("baking"); }, 1200);
    } catch (e: any) { setErr(e.message); }
    finally { setBakingIn(false); }
  }

  async function handleCompleteBake() {
    if (!completeRecord) return;
    setCompleting(true);
    try {
      const r = await fetch(API + "/lifecycle/baking/" + completeRecord.id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ result: completeResult, notes: completeNotes || undefined }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message || j.error || "Failed");
      setShowCompleteModal(false); setCompleteRecord(null); setCompleteResult("pass"); setCompleteNotes("");
      fetchOpenings(); fetchBaking();
    } catch (e: any) { setErr(e.message); }
    finally { setCompleting(false); }
  }

  const stats = useMemo(() => {
    const total = openings.length;
    const expired = openings.filter(o => calcRemainingHours(o.opened_shelf_life_days, o.opened_at) <= 0).length;
    const warning = openings.filter(o => { const r = calcRemainingHours(o.opened_shelf_life_days, o.opened_at); return isFinite(r) && r > 0 && r <= MSD_WARNING_HOURS; }).length;
    const urgent = openings.filter(o => { const r = calcProdCountdown(o.opened_shelf_life_days, o.opened_at, prodStart); return isFinite(r) && r > 0 && r <= 2; }).length;
    const baking = openings.filter(o => o.baking_required && o.baking_result === "pending").length;
    return { total, expired, warning, urgent, baking };
  }, [openings, prodStart]);

  const urgentLots = useMemo(() =>
    openings.filter(o => {
      const rem = calcRemainingHours(o.opened_shelf_life_days, o.opened_at);
      const pc = calcProdCountdown(o.opened_shelf_life_days, o.opened_at, prodStart);
      return rem <= 0 || (isFinite(pc) && pc <= 2) || (o.baking_required && o.baking_result === "pending");
    }), [openings, prodStart]);

  const dangerousLots = useMemo(() => [...urgentLots].sort((a, b) =>
    calcRemainingHours(a.opened_shelf_life_days, a.opened_at) - calcRemainingHours(b.opened_shelf_life_days, b.opened_at)
  ).slice(0, 8), [urgentLots]);

  const filteredOpenings = useMemo(() =>
    openings.filter(o => {
      const matchesSearch = !searchQ || o.lot_no.toLowerCase().includes(searchQ.toLowerCase()) || o.material_code.toLowerCase().includes(searchQ.toLowerCase()) || o.name_zh.includes(searchQ);
      const rem = calcRemainingHours(o.opened_shelf_life_days, o.opened_at);
      const prod = calcProdCountdown(o.opened_shelf_life_days, o.opened_at, prodStart);
      const isWarning = rem <= 24 || (isFinite(prod) && prod <= 2) || (o.baking_required && o.baking_result === "pending");
      return matchesSearch && (!warningOnly || isWarning);
    }), [openings, prodStart, searchQ, warningOnly]);

  const filteredSealed = useMemo(() =>
    sealedLots.filter(s => !searchQ || s.lotNo.toLowerCase().includes(searchQ.toLowerCase()) || s.materialCode.toLowerCase().includes(searchQ.toLowerCase()) || s.nameZh.includes(searchQ)), [sealedLots, searchQ]);

  const filteredBaking = useMemo(() =>
    bakingRecords.filter(r => !searchQ || r.lot_no.toLowerCase().includes(searchQ.toLowerCase()) || r.material_code.toLowerCase().includes(searchQ.toLowerCase()) || (r.operator_name || "").includes(searchQ)), [bakingRecords, searchQ]);

  const materialQueryCount = useMemo(() => {
    const q = submittedMaterialQuery.toLowerCase();
    if (!q) return null;
    return [...openings, ...sealedLots].filter((row: any) =>
      [row.material_code, row.materialCode, row.name_zh, row.nameZh, row.lot_no, row.lotNo, row.location_code, row.locationCode]
        .filter(Boolean).join(" ").toLowerCase().includes(q)
    ).length;
  }, [openings, sealedLots, submittedMaterialQuery]);

  const materialQuerySummary = useMemo(() => {
    const q = submittedMaterialQuery.toLowerCase();
    if (!q) return null;
    const matches = <T extends Record<string, unknown>>(rows: T[], fields: string[]) => rows.filter(row => fields.map(field => row[field]).filter(Boolean).join(" ").toLowerCase().includes(q));
    const opened = matches(openings as unknown as Record<string, unknown>[], ["material_code", "name_zh", "lot_no", "location_code"]);
    const sealed = matches(sealedLots as unknown as Record<string, unknown>[], ["materialCode", "nameZh", "lotNo", "locationCode"]);
    const baking = matches(bakingRecords as unknown as Record<string, unknown>[], ["material_code", "lot_no", "operator_name"]);
    const expired = opened.filter(row => calcRemainingHours(Number(row.opened_shelf_life_days), String(row.opened_at)) <= 0).length;
    const warning = opened.filter(row => {
      const rem = calcRemainingHours(Number(row.opened_shelf_life_days), String(row.opened_at));
      return rem <= 24 || Boolean(row.baking_required && row.baking_result === "pending");
    }).length;
    return { opened: opened.length, sealed: sealed.length, baking: baking.length, expired, warning };
  }, [bakingRecords, openings, sealedLots, submittedMaterialQuery]);

  const runMaterialQuery = () => {
    const q = materialQuery.trim();
    setSubmittedMaterialQuery(q);
    setSearchQ(q);
    setTab("opened");
  };

  return (
    <div className="screen-stack">
      <MsMoistureControlDiagram />
      <section className="surface-panel">
        <div className="section-header" style={{ marginBottom: 10 }}>
          <div>
            <h3 style={{ margin: 0 }}><Search size={16} style={{ marginRight: 7, verticalAlign: "middle" }} />物料查询</h3>
            <p style={{ margin: "4px 0 0", fontSize: 12 }}>按物料编码、物料名称、批次号或仓位查询MS物料状态。</p>
          </div>
          {submittedMaterialQuery && <span style={{ fontSize: 12, color: "var(--muted)" }}>匹配记录：<strong style={{ color: "var(--text)" }}>{materialQueryCount}</strong></span>}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            className="form-input"
            style={{ flex: "1 1 360px", minWidth: 260 }}
            value={materialQuery}
            onChange={e => setMaterialQuery(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") runMaterialQuery(); }}
            placeholder="例如：IC-DRAM-8G / LOT-260826-A17 / SMT-01"
            aria-label="物料查询"
          />
          <button className="btn-primary" onClick={runMaterialQuery}><Search size={14} /> 查询物料</button>
          <button className={warningOnly ? "btn-primary" : "btn-ghost"} onClick={() => { setWarningOnly(v => !v); setTab("opened"); }}>
            <AlertTriangle size={14} /> {warningOnly ? "显示全部" : "只看预警"}
          </button>
          <button className="btn-ghost" onClick={() => { setMaterialQuery(""); setSubmittedMaterialQuery(""); setSearchQ(""); setWarningOnly(false); }}>清除</button>
        </div>
        {materialQuerySummary && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
            <span className="badge badge-info">匹配开封箱：{materialQuerySummary.opened}</span>
            <span className="badge badge-warning">匹配预警：{materialQuerySummary.warning}</span>
            <span className="badge badge-ok">匹配未开封：{materialQuerySummary.sealed}</span>
            <span className="badge" style={{ background: "#8b5cf6", color: "#fff" }}>匹配烘烤记录：{materialQuerySummary.baking}</span>
            <span className="badge badge-danger">其中超时：{materialQuerySummary.expired}</span>
          </div>
        )}
      </section>
      <section className="surface-panel">
        <div className="section-header" style={{ marginBottom: 10 }}>
          <div>
            <h3 style={{ margin: 0 }}><AlertTriangle size={16} style={{ marginRight: 7, verticalAlign: "middle", color: "var(--danger)" }} />最高风险物料</h3>
            <p style={{ margin: "4px 0 0", fontSize: 12 }}>优先显示已超时、剩余≤24小时或待烘烤的MS物料。</p>
          </div>
          <span className="badge badge-danger">{dangerousLots.length} 条需关注</span>
        </div>
        <div className="table-shell" style={{ overflowX: "auto" }}>
          <table>
            <thead><tr><th>SN / 物料编码</th><th>批次</th><th>数量</th><th>记录ID</th><th>位置</th><th>剩余Floor Life</th><th>状态</th></tr></thead>
            <tbody>
              {dangerousLots.length === 0 ? <tr><td colSpan={7} style={{ textAlign: "center", padding: 20, color: "var(--muted)" }}>当前没有高风险MS物料</td></tr> : dangerousLots.map(o => {
                const rem = calcRemainingHours(o.opened_shelf_life_days, o.opened_at);
                const isBaking = o.baking_required && o.baking_result === "pending";
                return <tr key={`risk-${o.id}`} style={{ background: "rgba(239,68,68,0.045)" }}>
                  <td><strong>{o.serial_no || o.sn || o.material_code}</strong><div style={{ fontSize: 10, color: "var(--muted)", marginTop: 3 }}>{o.name_zh || "-"}</div></td>
                  <td><code style={{ fontSize: 11 }}>{o.lot_no}</code></td>
                  <td>{o.remaining_qty ?? o.opened_qty ?? o.received_qty ?? "-"}</td>
                  <td><code style={{ fontSize: 11 }}>MSD-{o.id}</code></td>
                  <td style={{ fontSize: 11 }}>{o.location_code || "-"}</td>
                  <td><span className="badge badge-danger">{rem <= 0 ? "已超时" : fmtHours(rem)}</span></td>
                  <td>{isBaking ? <span className="badge" style={{ background: "#8b5cf6", color: "#fff" }}>待烘烤</span> : rem <= 0 ? <span className="badge badge-danger">冻结 / 待处置</span> : <span className="badge badge-warning">即将到期</span>}</td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>
      </section>
      {/* Header */}
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2><ShieldAlert size={18} style={{ marginRight: 8, verticalAlign: "middle" }} />{t("wms.subnav.msd", locale)}</h2>
            <p>{t("wms.msd.prodCountdown", locale)}</p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <div className="scan-input" style={{ maxWidth: 200 }}>
                <Search size={14} />
                <input value={searchQ} onChange={e => setSearchQ(e.target.value)} placeholder={t("buttons.search", locale)} />
              </div>
              <input className="form-input" style={{ maxWidth: 220 }} value={openWorkOrderCodes} onChange={e => setOpenWorkOrderCodes(e.target.value)} placeholder="绑定工单/订单号（可多个）" />
            <button className="btn-primary" onClick={() => { setShowOpenModal(true); setErr(""); setOpenOk(false); }}>
              <Scan size={14} />{t("wms.msd.scanToOpen", locale)}
            </button>
          </div>
        </div>
      </section>

      {/* MSD等级参照表 (可折叠) */}
      <section className="surface-panel">
        <button onClick={() => setLevelExpanded(v => !v)} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", color: "var(--muted)", fontSize: 12, padding: "4px 0" }}>
          {levelExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          MS等级 / Floor Life 参照表 (IPC J-STD-033)
        </button>
        {levelExpanded && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 8, marginTop: 10 }}>
            {MSD_LEVELS.map(l => (
              <div key={l.level} style={{ padding: "8px 12px", borderRadius: 6, background: "var(--nav)", borderLeft: "3px solid " + l.color }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <strong style={{ color: l.color, fontSize: 13 }}>MS-{l.level}</strong>
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>{l.floorLife}</span>
                </div>
                <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>{l.note}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 产前起始时间 + 统计 */}
      <section className="surface-panel">
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 11, color: "var(--muted)" }}>{t("wms.msd.productionStart", locale)}</label>
            <input type="datetime-local" value={prodStart} onChange={e => setProdStart(e.target.value)}
              style={{ background: "var(--nav)", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 10px", color: "var(--text)", fontSize: 13, minWidth: 200 }} />
          </div>
          {[
            { label: t("wms.msd.openedLots", locale),     value: stats.total,    color: "var(--text)",  desc: "" },
            { label: "紧迫",    value: stats.urgent,    color: "var(--danger)", desc: "产前≤2h" },
            { label: t("wms.msd.approaching", locale),    value: stats.warning,   color: "#f59e0b",       desc: "≤168h" },
            { label: "烘烤中",  value: stats.baking,    color: "#8b5cf6",       desc: "" },
            { label: t("wms.msd.status.expired", locale), value: stats.expired,   color: "var(--danger)", desc: "" },
          ].map(card => (
            <div key={card.label} style={{ flex: 1, minWidth: 90, padding: "10px 14px", borderRadius: 8, background: "var(--nav)", display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 11, color: "var(--muted)" }}>{card.label}</span>
              <strong style={{ fontSize: 22, color: card.color }}>{card.value}</strong>
              <span style={{ fontSize: 10, color: "var(--muted)" }}>{card.desc}</span>
            </div>
          ))}
        </div>
        {stats.warning > 0 && (
          <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: 6, background: "rgba(245,158,11,0.12)", border: "1px solid #f59e0b", color: "#b45309", fontSize: 12 }}>
            <AlertTriangle size={13} style={{ verticalAlign: "middle", marginRight: 5 }} />
            MSD warning: {stats.warning} lot(s) have 30 days or less remaining floor life (720 hours).
          </div>
        )}
      </section>

      {/* 紧急批次快捷处理条 */}
      {urgentLots.length > 0 && (
        <section className="surface-panel" style={{ border: "1px solid var(--danger)", borderRadius: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
            <AlertTriangle size={15} color="var(--danger)" />
            <strong style={{ color: "var(--danger)", fontSize: 13 }}>需立即处理批次 ({urgentLots.length})</strong>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {urgentLots.map(lot => {
              const rem = calcRemainingHours(lot.opened_shelf_life_days, lot.opened_at);
              const pc = calcProdCountdown(lot.opened_shelf_life_days, lot.opened_at, prodStart);
              const isBaking = lot.baking_required && lot.baking_result === "pending";
              const isExpired = rem <= 0;
              return (
                <div key={lot.id} style={{ flex: "0 0 auto", padding: "8px 12px", borderRadius: 8, minWidth: 200, background: isBaking ? "rgba(139,92,246,0.12)" : "rgba(239,68,68,0.1)", border: "1px solid " + (isBaking ? "#8b5cf6" : "var(--danger)") }}>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>{lot.material_code}</div>
                  <code style={{ fontSize: 11 }}>{lot.lot_no}</code>
                  <div style={{ fontSize: 10, color: isBaking ? "#8b5cf6" : "var(--danger)", marginTop: 2 }}>
                    {isBaking ? "🔥 烘烤中…" : isExpired ? "⏱ 已超期 " + fmtHours(Math.abs(rem)) : "⏱ 产前剩余 " + fmtHours(pc)}
                  </div>
                  {!isBaking && (
                    <button className="btn-primary" style={{ marginTop: 6, padding: "3px 10px", fontSize: 11, width: "100%", background: "var(--danger)" }}
                      onClick={() => { setBakingLot(lot); setShowBakeModal(true); setBakeSuccess(false); setErr(""); }}>
                      <Flame size={11} /> 触发烘烤
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

       <section className="surface-panel">
         <div className="section-header"><div><h3>物料寿命报警</h3><p>实时接收近效期、超期和处理状态报警。</p></div><span className="status-chip">{alerts.length} 条</span></div>
         <div className="table-shell"><table><thead><tr><th>批次</th><th>物料</th><th>剩余寿命</th><th>报警内容</th><th>处理状态</th><th>责任人</th><th>处理计划</th></tr></thead><tbody>{alerts.length ? alerts.slice(0, 50).map(row => <tr key={row.id}><td><code>{row.lotNo}</code></td><td>{row.materialCode}<br /><span style={{ color: "var(--muted)" }}>{row.materialNameZh}</span></td><td style={{ color: (row.remainingDays ?? 999) <= 0 ? "var(--danger)" : (row.remainingDays ?? 999) <= 30 ? "#f59e0b" : "var(--ok)" }}>{row.remainingDays == null ? "-" : row.remainingDays <= 0 ? `已超期 ${Math.abs(row.remainingDays)} 天` : `${row.remainingDays} 天`}</td><td><strong>{row.alertLevel}</strong></td><td>{row.processingStatus || "待处理"}</td><td>{row.responsible || "-"}</td><td>{row.action_plan || "-"}</td></tr>) : <tr><td colSpan={7} style={{ textAlign: "center", padding: 18 }}>暂无寿命报警</td></tr>}</tbody></table></div>
       </section>

       <section className="surface-panel">
         <div className="section-header"><div><h3>开箱 FIFO 处理队列</h3><p>剩余寿命越短越靠前；出料后在扣料流程中更新剩余数量。</p></div><span className="status-chip">{filteredOpenings.length} 批</span></div>
         <div className="table-shell"><table><thead><tr><th>优先级</th><th>寿命跟踪ID</th><th>物料/批次</th><th>关联工单/订单</th><th>物料去向</th><th>整箱数量</th><th>本次开箱数量</th><th>部分拆箱后剩余</th><th>剩余寿命</th></tr></thead><tbody>{filteredOpenings.length ? filteredOpenings.map((o, index) => { const rem = calcRemainingHours(o.opened_shelf_life_days, o.opened_at); return <tr key={`fifo-${o.id}`}><td><strong>{index + 1}</strong></td><td><code>OPEN-{o.life_tracking_id ?? o.id}</code></td><td><strong>{o.material_code}</strong><br /><code>{o.lot_no}</code></td><td>{o.work_order_codes?.length ? o.work_order_codes.join(", ") : "-"}</td><td>{o.location_code || "-"}</td><td>{o.received_qty}</td><td>{o.opened_qty ?? o.received_qty}</td><td><strong>{o.remaining_qty ?? o.received_qty}</strong></td><td style={{ color: rem <= 0 ? "var(--danger)" : rem <= 48 ? "#f59e0b" : "var(--ok)" }}>{rem <= 0 ? "已超期" : fmtHours(rem)}</td></tr>; }) : <tr><td colSpan={9} style={{ textAlign: "center", padding: 18 }}>暂无开箱物料</td></tr>}</tbody></table></div>
       </section>

       {/* Tabs: opened / sealed / baking */}
      <section className="surface-panel">
        <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
          {([
            { key: "opened", label: t("wms.msd.openedLots", locale),     count: openings.length },
            { key: "sealed", label: t("wms.msd.sealedLots", locale),     count: sealedLots.length },
            { key: "baking",  label: "烘烤记录", count: bakingRecords.length },
            { key: "label",   label: "标签模板预览 / 打印", count: 1 },
            { key: "pdaSync", label: "PDA同步", count: 3 },
          ] as const).map(tb => (
            <button key={tb.key} className={"tab-btn " + (tab === tb.key ? "active" : "")} onClick={() => { setTab(tb.key); setSearchQ(""); }}>
              {tb.label} ({tb.count})
            </button>
          ))}
        </div>

        {err && <div style={{ padding: "8px 12px", background: "rgba(239,68,68,0.1)", borderRadius: 6, color: "var(--danger)", fontSize: 13, marginBottom: 8 }}>{err}</div>}

        {tab === "label" && <MsLabelPrintingPage />}
        {tab === "pdaSync" && <MsPdaSyncPage />}

        {/* Opened lots */}
        {tab === "opened" && (
          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th>{t("wms.msd.materialCode", locale)}</th>
                  <th>{t("wms.msd.lotNo", locale)}</th>
                  <th>{t("wms.msd.floorLife", locale)}</th>
                  <th>{t("wms.msd.exposedSince", locale)}</th>
                  <th>已暴露</th>
                  <th>{t("wms.msd.remainingLife", locale)}</th>
                  <th>封箱时间</th>
                  <th>{t("wms.msd.prodCountdown", locale)}</th>
                  <th>{t("wms.msd.location", locale)}</th>
                  <th>状态</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {loadingOpenings ? <tr><td colSpan={10} style={{ textAlign: "center", padding: 24, color: "var(--muted)" }}>Loading…</td></tr>
                 : filteredOpenings.length === 0 ? <tr><td colSpan={10} style={{ textAlign: "center", padding: 24, color: "var(--muted)" }}>{t("common.noData", locale)}</td></tr>
                 : filteredOpenings.map(o => {
                  const isClosed = Boolean(o.closed_at);
                  const remH = isClosed ? o.opened_shelf_life_days * 24 - (new Date(o.closed_at!).getTime() - new Date(o.opened_at).getTime()) / 3_600_000 : calcRemainingHours(o.opened_shelf_life_days, o.opened_at);
                  const pcH = isClosed ? NaN : calcProdCountdown(o.opened_shelf_life_days, o.opened_at, prodStart);
                  const lc = lifeColor(remH);
                  const pc = prodColor(pcH);
                  const maxH = o.opened_shelf_life_days * 24;
                  const exposedH = maxH - remH;
                  const pct = maxH > 0 ? Math.min(100, (exposedH / maxH) * 100) : 0;
                  const isBaking = !isClosed && o.baking_required && o.baking_result === "pending";
                  const isBaked = o.baking_required && o.baking_result === "pass";
                  return (
                    <tr key={o.id} style={remH <= 0 ? { background: "rgba(239,68,68,0.05)" } : {}}>
                      <td><strong style={{ fontSize: 13 }}>{o.material_code}</strong><br /><span style={{ fontSize: 10, color: "var(--muted)" }}>{o.name_zh}</span></td>
                      <td><code style={{ fontSize: 10 }}>{o.lot_no}</code></td>
                      <td style={{ fontSize: 12, whiteSpace: "nowrap" }}>{o.opened_shelf_life_days}d</td>
                      <td style={{ fontSize: 11, whiteSpace: "nowrap" }}>{fmtDt(o.opened_at)}</td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 80 }}>
                          <Clock size={11} color="var(--muted)" /><span style={{ fontSize: 12 }}>{fmtHours(exposedH)}</span>
                        </div>
                        <div style={{ width: 72, height: 3, background: "var(--border)", borderRadius: 2, marginTop: 2 }}>
                          <div style={{ width: pct + "%", height: 3, background: pct > 80 ? "var(--danger)" : pct > 50 ? "#f59e0b" : "var(--ok)", borderRadius: 2 }} />
                        </div>
                      </td>
                      <td><span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 4, fontWeight: 600, fontSize: 12, background: lc, color: "#fff" }}>{remH <= 0 ? t("wms.msd.status.expired", locale) : fmtHours(remH)}</span></td>
                      <td style={{ fontSize: 11, whiteSpace: "nowrap" }}>{o.closed_at ? fmtDt(o.closed_at) : "未封箱"}</td>
                      <td>
                        {isFinite(pcH) ? <span style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "2px 8px", borderRadius: 4, fontWeight: 700, fontSize: 12, background: pc, color: "#fff" }}><Zap size={11} />{pcH <= 0 ? t("wms.msd.status.expired", locale) : fmtHours(pcH)}</span>
                         : <span style={{ fontSize: 11, color: "var(--muted)" }}>—</span>}
                      </td>
                      <td style={{ fontSize: 11 }}>{o.location_code || "—"}</td>
                      <td>
                        {isBaking ? <span className="badge" style={{ background: "#8b5cf6", color: "#fff", fontSize: 10 }}><Flame size={10} /> 烘烤中</span>
                         : isBaked ? <span className="badge badge-ok" style={{ fontSize: 10 }}><CheckCircle size={10} /> 已烘烤</span>
                         : remH <= 0 ? <span className="badge" style={{ background: "var(--danger)", color: "#fff", fontSize: 10 }}><Lock size={10} /> 需烘烤</span>
                         : <span style={{ fontSize: 11, color: "var(--muted)" }}>—</span>}
                      </td>
                      <td>
                        <button className="btn-ghost" style={{ padding: "3px 8px", fontSize: 11 }}
                          onClick={() => printRemainingInfo(o, remH, pcH)} title="Print remaining MSD information">
                          <Printer size={11} /> 打印剩余信息
                        </button>
                        <button className="btn-ghost" style={{ padding: "3px 8px", fontSize: 11 }} onClick={() => void printMaterialLabel(o, remH)}>
                          <Printer size={11} /> 打印物料标签
                        </button>
                        {!isClosed && <button className="btn-primary" style={{ padding: "3px 10px", fontSize: 11 }} disabled={sealing === o.id} onClick={() => void handleSeal(o)}>
                          <Lock size={11} /> {sealing === o.id ? "封箱中" : "封箱并记录"}
                        </button>}
                        {(remH <= 0 || (isFinite(pcH) && pcH <= 2)) && !isBaking && (
                          <button className="btn-primary" style={{ padding: "3px 10px", fontSize: 11, background: "var(--danger)" }}
                            onClick={() => { setBakingLot(o); setShowBakeModal(true); setBakeSuccess(false); setErr(""); }}>
                            <Flame size={11} /> 烘烤
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Sealed lots */}
        {tab === "sealed" && (
          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th>{t("wms.msd.materialCode", locale)}</th>
                  <th>{t("wms.msd.lotNo", locale)}</th>
                  <th>MS Level</th>
                  <th>{t("wms.msd.floorLife", locale)}</th>
                  <th>{t("wms.msd.qty", locale)}</th>
                  <th>{t("wms.msd.location", locale)}</th>
                  <th>IQC</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {loadingSealed ? <tr><td colSpan={8} style={{ textAlign: "center", padding: 24, color: "var(--muted)" }}>Loading…</td></tr>
                 : filteredSealed.length === 0 ? <tr><td colSpan={8} style={{ textAlign: "center", padding: 24, color: "var(--muted)" }}>{t("common.noData", locale)}</td></tr>
                 : filteredSealed.map(s => (
                  <tr key={s.id}>
                    <td><strong style={{ fontSize: 13 }}>{s.materialCode}</strong><br /><span style={{ fontSize: 10, color: "var(--muted)" }}>{s.nameZh}</span></td>
                    <td><code style={{ fontSize: 10 }}>{s.lotNo}</code></td>
                    <td><span className="badge" style={{ background: s.msdLevel === "1" ? "var(--ok)" : s.msdLevel === "2" ? "#3b82f6" : s.msdLevel === "2a" ? "#f59e0b" : "var(--danger)", color: "#fff", fontSize: 10 }}>MS-{s.msdLevel}</span></td>
                    <td style={{ fontSize: 12 }}>{s.shelfLifeDays}d</td>
                    <td style={{ fontSize: 12 }}>{s.qty}</td>
                    <td style={{ fontSize: 11 }}>{s.locationCode || "—"}</td>
                    <td><span className={"badge badge-" + (s.iqcStatus === "released" ? "ok" : s.iqcStatus === "pending" ? "warning" : "info")} style={{ fontSize: 10 }}>{s.iqcStatus}</span></td>
                    <td>
                      <button className="btn-primary" style={{ padding: "4px 10px", fontSize: 11 }}
                        onClick={() => { setOpenLotNo(s.lotNo); setShowOpenModal(true); setErr(""); setOpenOk(false); }}>
                        <Scan size={11} />{t("wms.msd.openNow", locale)}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Baking records */}
        {tab === "baking" && (
          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th>{t("wms.msd.lotNo", locale)}</th>
                  <th>{t("wms.msd.materialCode", locale)}</th>
                  <th>操作员</th>
                  <th>开始时间</th>
                  <th>结束时间</th>
                  <th>温度</th>
                  <th>湿度</th>
                  <th>烘箱</th>
                  <th>结果</th>
                  <th>备注</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {loadingBaking ? <tr><td colSpan={11} style={{ textAlign: "center", padding: 24, color: "var(--muted)" }}>Loading…</td></tr>
                 : filteredBaking.length === 0 ? <tr><td colSpan={11} style={{ textAlign: "center", padding: 24, color: "var(--muted)" }}>{t("common.noData", locale)}</td></tr>
                 : filteredBaking.map(r => (
                  <tr key={r.id} style={r.result === "fail" ? { background: "rgba(239,68,68,0.06)" } : r.result === "pass" ? { background: "rgba(34,197,94,0.04)" } : {}}>
                    <td><code style={{ fontSize: 10 }}>{r.lot_no}</code></td>
                    <td><strong style={{ fontSize: 12 }}>{r.material_code}</strong><br /><span style={{ fontSize: 10, color: "var(--muted)" }}>{r.name_zh}</span></td>
                    <td style={{ fontSize: 11 }}>{r.operator_name || "—"}</td>
                    <td style={{ fontSize: 11, whiteSpace: "nowrap" }}>{fmtDt(r.started_at)}</td>
                    <td style={{ fontSize: 11, whiteSpace: "nowrap" }}>{fmtDt(r.completed_at)}</td>
                    <td style={{ fontSize: 12 }}>{r.temperature != null ? r.temperature + "℃" : "—"}</td>
                    <td style={{ fontSize: 12 }}>{r.humidity != null ? r.humidity + "%" : "—"}</td>
                    <td style={{ fontSize: 11 }}>{r.oven_no || "—"}</td>
                    <td>
                      {r.result === "pass" ? <span className="badge badge-ok" style={{ fontSize: 10 }}><CheckCircle size={10} /> 合格</span>
                       : r.result === "fail" ? <span className="badge" style={{ background: "var(--danger)", color: "#fff", fontSize: 10 }}><Lock size={10} /> 报废</span>
                       : r.result === "pending" ? <span className="badge" style={{ background: "#8b5cf6", color: "#fff", fontSize: 10 }}><Flame size={10} /> 进行中</span>
                       : <span style={{ fontSize: 11, color: "var(--muted)" }}>—</span>}
                    </td>
                    <td style={{ fontSize: 10, color: "var(--muted)", maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.notes || "—"}</td>
                    <td>
                      {r.result === "pending" && (
                        <button className="btn-primary" style={{ padding: "3px 10px", fontSize: 11 }}
                          onClick={() => { setCompleteRecord(r); setShowCompleteModal(true); setCompleteResult("pass"); setCompleteNotes(""); setErr(""); }}>
                          <CheckCircle size={11} /> 完成
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 开箱 Modal */}
      {showOpenModal && (
        <div className="modal-overlay" onClick={() => !opening && setShowOpenModal(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()} style={{ minWidth: 380, maxWidth: 460 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h3 style={{ margin: 0 }}><Scan size={16} style={{ marginRight: 6, verticalAlign: "middle" }} />{t("wms.msd.scanToOpen", locale)}</h3>
              <button onClick={() => !opening && setShowOpenModal(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)" }}><X size={18} /></button>
            </div>
            {openOk ? (
              <div style={{ textAlign: "center", padding: "32px 0" }}>
                <CheckCircle size={48} color="var(--ok)" style={{ marginBottom: 12 }} />
                <p style={{ fontSize: 16, fontWeight: 600, color: "var(--ok)" }}>{t("wms.msd.openSuccess", locale)}</p>
              </div>
            ) : (
              <>
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div>
                    <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>{t("wms.msd.lotNo", locale)} *</label>
                    <input className="form-input" value={openLotNo} onChange={e => setOpenLotNo(e.target.value)} placeholder={t("wms.msd.noLotSelected", locale)} autoFocus onKeyDown={e => e.key === "Enter" && handleOpen()} />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>{t("wms.msd.floorLife", locale)} (days + hours)</label>
                    <div style={{ display: "flex", gap: 8 }}>
                      <input className="form-input" type="number" min="0" step="1" value={openShelfLifeDays} onChange={e => setOpenShelfLifeDays(e.target.value)} placeholder="Days" />
                      <input className="form-input" type="number" min="0" max="23" step="1" value={openShelfLifeHours} onChange={e => setOpenShelfLifeHours(e.target.value)} placeholder="Hours" />
                    </div>
                    <p style={{ fontSize: 10, color: "var(--muted)", marginTop: 3 }}>MS Level 对应的标准暴露时限（天），系统将自动记录开箱时间</p>
                  </div>
                </div>
                {err && <div style={{ marginTop: 10, padding: "8px 12px", background: "rgba(239,68,68,0.1)", borderRadius: 6, color: "var(--danger)", fontSize: 13 }}>{err}</div>}
                <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
                  <button className="btn-ghost" style={{ flex: 1 }} onClick={() => setShowOpenModal(false)} disabled={opening}>{t("common.cancel", locale)}</button>
                  <button className="btn-primary" style={{ flex: 1 }} onClick={handleOpen} disabled={opening || !openLotNo.trim()}>{opening ? t("common.loading", locale) : t("wms.msd.openNow", locale)}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* 烘烤触发 Modal */}
      {showBakeModal && bakingLot && (
        <div className="modal-overlay" onClick={() => !bakingIn && setShowBakeModal(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()} style={{ minWidth: 420, maxWidth: 520 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h3 style={{ margin: 0 }}><Flame size={16} style={{ marginRight: 6, verticalAlign: "middle", color: "#f59e0b" }} />触发烘烤</h3>
              <button onClick={() => !bakingIn && setShowBakeModal(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)" }}><X size={18} /></button>
            </div>
            {bakeSuccess ? (
              <div style={{ textAlign: "center", padding: "32px 0" }}>
                <CheckCircle size={48} color="#8b5cf6" style={{ marginBottom: 12 }} />
                <p style={{ fontSize: 16, fontWeight: 600, color: "#8b5cf6" }}>烘烤已启动</p>
                <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>批次 {bakingLot.lot_no} 已进入烘烤流程</p>
              </div>
            ) : (
              <>
                <div style={{ padding: "10px 12px", background: "rgba(245,158,11,0.1)", borderRadius: 8, marginBottom: 16, fontSize: 12 }}>
                  <strong>{bakingLot.material_code}</strong> <span style={{ color: "var(--muted)" }}>{bakingLot.name_zh}</span>
                  <br /><code>{bakingLot.lot_no}</code>
                  <br /><span style={{ color: "var(--danger)" }}>剩余寿命: {fmtHours(calcRemainingHours(bakingLot.opened_shelf_life_days, bakingLot.opened_at))}</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>烘烤温度 (℃) *</label>
                    <input className="form-input" type="number" value={bakeTemp} onChange={e => setBakeTemp(e.target.value)} placeholder="125" />
                    <p style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>标准: 125℃ 或 150℃</p>
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>湿度 (%)</label>
                    <input className="form-input" type="number" value={bakeHumidity} onChange={e => setBakeHumidity(e.target.value)} placeholder="≤5%RH" />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>烘箱编号</label>
                    <input className="form-input" value={bakeOven} onChange={e => setBakeOven(e.target.value)} placeholder="OVEN-01" />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>操作员</label>
                    <input className="form-input" value={bakeOperator} onChange={e => setBakeOperator(e.target.value)} placeholder="操作员姓名" />
                  </div>
                </div>
                <div style={{ marginTop: 12 }}>
                  <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>备注</label>
                  <input className="form-input" value={bakeNotes} onChange={e => setBakeNotes(e.target.value)} placeholder="可选备注" />
                </div>
                {err && <div style={{ marginTop: 10, padding: "8px 12px", background: "rgba(239,68,68,0.1)", borderRadius: 6, color: "var(--danger)", fontSize: 13 }}>{err}</div>}
                <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
                  <button className="btn-ghost" style={{ flex: 1 }} onClick={() => setShowBakeModal(false)} disabled={bakingIn}>{t("common.cancel", locale)}</button>
                  <button className="btn-primary" style={{ flex: 1, background: "#8b5cf6" }} onClick={handleStartBake} disabled={bakingIn || !bakeTemp}>
                    {bakingIn ? t("common.loading", locale) : <><Flame size={13} /> 开始烘烤</>}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* 完成烘烤 Modal */}
      {showCompleteModal && completeRecord && (
        <div className="modal-overlay" onClick={() => !completing && setShowCompleteModal(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()} style={{ minWidth: 380, maxWidth: 460 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h3 style={{ margin: 0 }}><CheckCircle size={16} style={{ marginRight: 6, verticalAlign: "middle", color: "var(--ok)" }} />完成烘烤</h3>
              <button onClick={() => !completing && setShowCompleteModal(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)" }}><X size={18} /></button>
            </div>
            <div style={{ padding: "10px 12px", background: "var(--nav)", borderRadius: 8, marginBottom: 16, fontSize: 12 }}>
              <code>{completeRecord.lot_no}</code><br />
              <span style={{ color: "var(--muted)" }}>{completeRecord.material_code} {completeRecord.name_zh}</span><br />
              开始: {fmtDt(completeRecord.started_at)}
              {completeRecord.temperature && <> | {completeRecord.temperature}℃</>}
              {completeRecord.oven_no && <> | {completeRecord.oven_no}</>}
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 8 }}>烘烤结果 *</label>
              <div style={{ display: "flex", gap: 8 }}>
                {(["pass", "fail"] as const).map(r => (
                  <button key={r} onClick={() => setCompleteResult(r)}
                    style={{
                      flex: 1, padding: "10px", borderRadius: 8, border: "2px solid",
                      borderColor: completeResult === r ? (r === "pass" ? "var(--ok)" : "var(--danger)") : "var(--border)",
                      background: completeResult === r ? (r === "pass" ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)") : "var(--nav)",
                      color: completeResult === r ? (r === "pass" ? "var(--ok)" : "var(--danger)") : "var(--muted)",
                      cursor: "pointer", fontWeight: 600, fontSize: 13,
                    }}>
                    {r === "pass" ? <><CheckCircle size={13} /> 合格 — 继续使用</> : <><Lock size={13} /> 报废 — 不能使用</>}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>备注</label>
              <input className="form-input" value={completeNotes} onChange={e => setCompleteNotes(e.target.value)} placeholder="可选备注" />
            </div>
            {err && <div style={{ marginTop: 10, padding: "8px 12px", background: "rgba(239,68,68,0.1)", borderRadius: 6, color: "var(--danger)", fontSize: 13 }}>{err}</div>}
            <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
              <button className="btn-ghost" style={{ flex: 1 }} onClick={() => setShowCompleteModal(false)} disabled={completing}>{t("common.cancel", locale)}</button>
              <button className="btn-primary" style={{ flex: 1 }} onClick={handleCompleteBake} disabled={completing}>
                {completing ? t("common.loading", locale) : <><CheckCircle size={13} /> 确认结果</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
