// MES-ruijing W6c 前端 —— 维修 / 报废 / 设备健康 / 良率 / 返修列表 / 工单物料 / AI 工位 / 老化 / 物料追溯
// 路由（后端 services/api/src/routes/mesrj.js）：
//   POST  /exec/repair           返修登记
//   POST  /exec/scrap            报废登记
//   GET   /exec/device/health    设备健康
//   GET   /exec/yield            良率报表
//   GET   /exec/repair/list      返修列表（分页）
//   GET   /exec/mo/materials     工单物料
//   GET   /exec/ai/stations      AI 工位
//   GET   /exec/aging            老化分析（滞留）
//   GET   /exec/aging/detail     老化明细
//   GET   /exec/trace/material   物料追溯（按 SN）
//   GET   /exec/trace/material/sns 物料追溯（按物料）
import { useCallback, useEffect, useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { mesrjApi } from "./api";
import { t } from "./i18n";

const box = { border: "1px solid var(--border, #e2e8f0)", borderRadius: 10, padding: 14, marginBottom: 14 } as const;
const inp = { padding: "6px 8px", marginRight: 6 } as const;

function Err({ msg }: { msg: string }) {
  if (!msg) return null;
  return <div style={{ color: "#b91c1c", padding: "6px 0", fontSize: 13, whiteSpace: "pre-wrap" }}>{msg}</div>;
}
function Ok({ msg }: { msg: string }) {
  if (!msg) return null;
  return <div style={{ color: "#15803d", padding: "6px 0", fontSize: 13, whiteSpace: "pre-wrap" }}>{msg}</div>;
}

function Table({ header, rows }: { header: string[]; rows: Record<string, unknown>[] }) {
  if (rows.length === 0) return <div style={{ color: "#94a3b8", fontSize: 13 }}>No data</div>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr>
            {header.map(h => (
              <th key={h} style={{ padding: "6px 8px", borderBottom: "1px solid var(--border, #e2e8f0)", textAlign: "left" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderBottom: "1px solid #f1f5f9" }}>
              {header.map(h => (
                <td key={h} style={{ padding: "5px 8px" }}>{String(r[h] ?? "")}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RepairView({ locale }: { locale: Locale }) {
  const [sn, setSn] = useState("");
  const [station, setStation] = useState("");
  const [defectCode, setDefectCode] = useState("");
  const [rootCause, setRootCause] = useState("");
  const [action, setAction] = useState("");
  const [result, setResult] = useState("");
  const [repairBy, setRepairBy] = useState("");
  const [remark, setRemark] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sn) return setErr("SN 必填");
    setBusy(true);
    try {
      const d = await mesrjApi.post<{ msg?: string }>("/exec/repair", {
        sn, station_code: station, defect_code: defectCode, root_cause: rootCause,
        action, result, repair_by: repairBy, remark,
      });
      setMsg(d?.msg || "返修登记完成");
    } catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <div style={box}>{t("w6c.title.repair", locale)}</div>
      <form onSubmit={submit} style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontSize: 12, color: "#64748b" }}>{t("sn.field.sn", locale)}</div>
          <input value={sn} onChange={e => setSn(e.target.value)} placeholder={t("sn.field.sn", locale)} style={{ ...inp, width: 170 }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontSize: 12, color: "#64748b" }}>{t("sn.field.station_code", locale)}</div>
          <input value={station} onChange={e => setStation(e.target.value)} style={{ ...inp, width: 140 }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontSize: 12, color: "#64748b" }}>{t("sn.field.defect_code", locale)}</div>
          <input value={defectCode} onChange={e => setDefectCode(e.target.value)} style={{ ...inp, width: 140 }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontSize: 12, color: "#64748b" }}>{t("w6c.field.root_cause", locale)}</div>
          <input value={rootCause} onChange={e => setRootCause(e.target.value)} style={{ ...inp, width: 160 }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontSize: 12, color: "#64748b" }}>{t("w6c.field.action", locale)}</div>
          <input value={action} onChange={e => setAction(e.target.value)} style={{ ...inp, width: 120 }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontSize: 12, color: "#64748b" }}>{t("sn.field.result", locale)}</div>
          <input value={result} onChange={e => setResult(e.target.value)} style={{ ...inp, width: 100 }} />
        </div>
        <button type="submit" disabled={busy}>{t("w6c.action.repair", locale)}</button>
      </form>
      <Err msg={err} /><Ok msg={msg} />
    </div>
  );
}

export function ScrapView({ locale }: { locale: Locale }) {
  const [sn, setSn] = useState("");
  const [station, setStation] = useState("");
  const [scrapCode, setScrapCode] = useState("");
  const [reason, setReason] = useState("");
  const [moNo, setMoNo] = useState("");
  const [approvedBy, setApprovedBy] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sn) return setErr("SN 必填");
    setBusy(true);
    try {
      const d = await mesrjApi.post<{ msg?: string }>("/exec/scrap", {
        sn, station_code: station, scrap_code: scrapCode, reason,
        mo_no: moNo, approved_by: approvedBy,
      });
      setMsg(d?.msg || "报废登记完成");
    } catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <div style={box}>{t("w6c.title.scrap", locale)}</div>
      <form onSubmit={submit} style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontSize: 12, color: "#64748b" }}>{t("sn.field.sn", locale)}</div>
          <input value={sn} onChange={e => setSn(e.target.value)} placeholder={t("sn.field.sn", locale)} style={{ ...inp, width: 170 }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontSize: 12, color: "#64748b" }}>{t("sn.field.station_code", locale)}</div>
          <input value={station} onChange={e => setStation(e.target.value)} style={{ ...inp, width: 140 }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontSize: 12, color: "#64748b" }}>{t("w6c.field.scrap_code", locale)}</div>
          <input value={scrapCode} onChange={e => setScrapCode(e.target.value)} style={{ ...inp, width: 140 }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontSize: 12, color: "#64748b" }}>{t("sn.field.reason", locale)}</div>
          <input value={reason} onChange={e => setReason(e.target.value)} style={{ ...inp, width: 160 }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontSize: 12, color: "#64748b" }}>{t("sn.field.mo_no", locale)}</div>
          <input value={moNo} onChange={e => setMoNo(e.target.value)} style={{ ...inp, width: 140 }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontSize: 12, color: "#64748b" }}>{t("w6c.field.approved_by", locale)}</div>
          <input value={approvedBy} onChange={e => setApprovedBy(e.target.value)} style={{ ...inp, width: 140 }} />
        </div>
        <button type="submit" disabled={busy}>{t("w6c.action.scrap", locale)}</button>
      </form>
      <Err msg={err} /><Ok msg={msg} />
    </div>
  );
}

export function DeviceHealthView({ locale }: { locale: Locale }) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    try { setRows(await mesrjApi.get<Record<string, unknown>[]>("/exec/device/health")); }
    catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  return (
    <div>
      <div style={box}>{t("w6c.title.deviceHealth", locale)}</div>
      <Err msg={err} />
      <Table header={[t("sn.field.device_id", locale), t("sn.field.device_name", locale), t("sn.field.device_type", locale),
        t("field.status", locale), t("w6c.field.last_heartbeat", locale), t("w6c.field.healthy", locale)]}
        rows={rows.map(r => ({
          device_id: r.device_id, device_name: r.device_name, device_type: r.device_type,
          status: r.status, last_heartbeat_at: r.last_heartbeat_at, healthy: r.healthy ? "是" : "否",
        } as Record<string, unknown>))} />
    </div>
  );
}

export function YieldView({ locale }: { locale: Locale }) {
  const [lineCode, setLineCode] = useState("");
  const [stationCode, setStationCode] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    try { setRows(await mesrjApi.get<Record<string, unknown>[]>("/exec/yield", { line_code: lineCode || undefined, station_code: stationCode || undefined, from: from || undefined, to: to || undefined })); }
    catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
    finally { setBusy(false); }
  }, [lineCode, stationCode, from, to]);
  return (
    <div>
      <div style={{ ...box, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>{t("w6c.title.yield", locale)}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontSize: 12, color: "#64748b" }}>{t("sn.field.line_code", locale)}</div>
          <input value={lineCode} onChange={e => setLineCode(e.target.value)} style={{ ...inp, width: 140 }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontSize: 12, color: "#64748b" }}>{t("sn.field.station_code", locale)}</div>
          <input value={stationCode} onChange={e => setStationCode(e.target.value)} style={{ ...inp, width: 140 }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontSize: 12, color: "#64748b" }}>{t("w6c.field.from", locale)}</div>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ ...inp, width: 140 }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontSize: 12, color: "#64748b" }}>{t("w6c.field.to", locale)}</div>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} style={{ ...inp, width: 140 }} />
        </div>
        <button onClick={load} disabled={busy}>{t("snlist.search", locale)}</button>
      </div>
      <Err msg={err} />
      <Table header={[t("sn.field.station_code", locale), t("station.field.station_name", locale), t("sn.field.line_code", locale),
        t("sn.field.total", locale), t("w6c.field.ok_cnt", locale), t("w6c.field.ng_cnt", locale), t("w6c.field.yield_pct", locale)]}
        rows={rows.map(r => ({
          station_code: r.station_code, station_name: r.station_name, line_code: r.line_code,
          total: r.total, ok_cnt: r.ok_cnt, ng_cnt: r.ng_cnt, yield_pct: r.yield_pct,
        } as Record<string, unknown>))} />
    </div>
  );
}

export function RepairListView({ locale }: { locale: Locale }) {
  const [sn, setSn] = useState("");
  const [stationCode, setStationCode] = useState("");
  const [result, setResult] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    try {
      const d = await mesrjApi.get<{ total: number; page: number; size: number; rows: Record<string, unknown>[] }>(
        "/exec/repair/list", { sn: sn || undefined, station_code: stationCode || undefined, result: result || undefined,
          from: from || undefined, to: to || undefined, page, size });
      setRows(d.rows); setTotal(d.total);
    } catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
    finally { setBusy(false); }
  }, [page, size, sn, stationCode, result, from, to]);
  useEffect(() => { load(); }, [load]);
  return (
    <div>
      <div style={{ ...box, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div style={{ fontSize: 12, color: "#64748b" }}>{t("w6c.title.repairList", locale)}</div>
        <input value={sn} onChange={e => setSn(e.target.value)} placeholder={t("sn.field.sn", locale)} style={{ ...inp, width: 150 }} />
        <input value={stationCode} onChange={e => setStationCode(e.target.value)} placeholder={t("sn.field.station_code", locale)} style={{ ...inp, width: 120 }} />
        <input value={result} onChange={e => setResult(e.target.value)} placeholder={t("sn.field.result", locale)} style={{ ...inp, width: 80 }} />
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ ...inp, width: 130 }} />
        <input type="date" value={to} onChange={e => setTo(e.target.value)} style={{ ...inp, width: 130 }} />
        <button onClick={load} disabled={busy}>{t("snlist.search", locale)}</button>
      </div>
      <Err msg={err} />
      <Table header={[t("sn.field.sn", locale), t("sn.field.repair_times", locale), t("sn.field.station_code", locale),
        t("sn.field.defect_code", locale), t("w6c.field.root_cause", locale), t("w6c.field.action", locale),
        t("sn.field.result", locale), t("w6c.field.repair_by", locale), t("w6c.field.repair_time", locale)]}
        rows={rows.map(r => ({
          sn: r.sn, repair_times: r.repair_times, station_code: r.station_code, defect_code: r.defect_code,
          root_cause: r.root_cause, action: r.action, result: r.result, repair_by: r.repair_by, repair_time: r.repair_time,
        } as Record<string, unknown>))} />
      <div style={{ fontSize: 12, color: "#64748b", marginTop: 6 }}>{t("common.total", locale)} {total}</div>
    </div>
  );
}

export function MoMaterialsView({ locale }: { locale: Locale }) {
  const [moNo, setMoNo] = useState("");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const load = async () => {
    if (!moNo) return;
    setBusy(true);
    try { setRows(await mesrjApi.get<Record<string, unknown>[]>("/exec/mo/materials", { mo_no: moNo })); }
    catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
    finally { setBusy(false); }
  };
  return (
    <div>
      <div style={{ ...box, display: "flex", gap: 8, alignItems: "flex-end" }}>
        <div style={{ fontSize: 12, color: "#64748b" }}>{t("w6c.title.moMaterials", locale)}</div>
        <input value={moNo} onChange={e => setMoNo(e.target.value)} placeholder={t("sn.field.mo_no", locale)} style={{ ...inp, width: 200 }} />
        <button onClick={load} disabled={busy}>{t("snlist.search", locale)}</button>
      </div>
      <Err msg={err} />
      <Table header={[t("sn.field.material_code", locale), t("sn.field.material_name", locale), t("sn.field.spec", locale),
        t("sn.field.unit", locale), t("w6c.field.qty", locale), t("w6c.field.line_seq", locale),
        t("sn.field.segment", locale), t("sn.field.item_type", locale)]}
        rows={rows.map(r => ({
          material_code: r.material_code, material_name: r.material_name, spec: r.spec, unit: r.unit,
          qty: r.qty, line_seq: r.line_seq, segment: r.segment, item_type: r.item_type,
        } as Record<string, unknown>))} />
    </div>
  );
}

export function AiStationsView({ locale }: { locale: Locale }) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    try { setRows(await mesrjApi.get<Record<string, unknown>[]>("/exec/ai/stations")); }
    catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  return (
    <div>
      <div style={box}>{t("w6c.title.aiStations", locale)}</div>
      <Err msg={err} />
      <Table header={[t("sn.field.station_code", locale), t("station.field.station_name", locale), t("sn.field.line_code", locale),
        t("sn.field.process_code", locale), t("sn.field.type_code", locale)]}
        rows={rows.map(r => ({
          station_code: r.station_code, station_name: r.station_name, line_code: r.line_code,
          process_code: r.process_code, type_code: r.type_code,
        } as Record<string, unknown>))} />
    </div>
  );
}

export function AgingView({ locale }: { locale: Locale }) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    try { setRows(await mesrjApi.get<Record<string, unknown>[]>("/exec/aging")); }
    catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  return (
    <div>
      <div style={box}>{t("w6c.title.aging", locale)}</div>
      <Err msg={err} />
      <Table header={[t("sn.field.station_code", locale), t("station.field.station_name", locale), t("snlist.empty", locale),
        t("w6c.field.earliest_in", locale), t("w6c.field.max_hours", locale)]}
        rows={rows.map(r => ({
          station_code: r.station_code, station_name: r.station_name,
          sn_cnt: r.sn_cnt, earliest_in: r.earliest_in, max_hours: r.max_hours,
        } as Record<string, unknown>))} />
    </div>
  );
}

export function AgingDetailView({ locale }: { locale: Locale }) {
  const [stationCode, setStationCode] = useState("");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const load = async () => {
    if (!stationCode) return;
    setBusy(true);
    try { setRows(await mesrjApi.get<Record<string, unknown>[]>("/exec/aging/detail", { station_code: stationCode })); }
    catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
    finally { setBusy(false); }
  };
  return (
    <div>
      <div style={{ ...box, display: "flex", gap: 8, alignItems: "flex-end" }}>
        <div style={{ fontSize: 12, color: "#64748b" }}>{t("w6c.title.agingDetail", locale)}</div>
        <input value={stationCode} onChange={e => setStationCode(e.target.value)} placeholder={t("sn.field.station_code", locale)} style={{ ...inp, width: 200 }} />
        <button onClick={load} disabled={busy}>{t("snlist.search", locale)}</button>
      </div>
      <Err msg={err} />
      <Table header={[t("sn.field.sn", locale), t("sn.field.product_code", locale), t("sn.field.mo_no", locale),
        t("sn.field.cur_station", locale), t("field.status", locale), t("sn.field.created_at", locale),
        t("w6c.field.hours", locale)]}
        rows={rows.map(r => ({
          sn: r.sn, product_code: r.product_code, mo_no: r.mo_no, cur_station: r.cur_station,
          status: r.status, created_at: r.created_at, hours: r.hours,
        } as Record<string, unknown>))} />
    </div>
  );
}

export function TraceMaterialBySnView({ locale }: { locale: Locale }) {
  const [sn, setSn] = useState("");
  const [meta, setMeta] = useState<Record<string, unknown> | null>(null);
  const [materials, setMaterials] = useState<Record<string, unknown>[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const load = async () => {
    if (!sn) return;
    setBusy(true);
    try {
      const d = await mesrjApi.get<{ sn: string; mo_no: string; product_code: string; materials: Record<string, unknown>[] }>(
        "/exec/trace/material", { sn });
      setMeta(d); setMaterials(d.materials);
    } catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
    finally { setBusy(false); }
  };
  return (
    <div>
      <div style={{ ...box, display: "flex", gap: 8, alignItems: "flex-end" }}>
        <div style={{ fontSize: 12, color: "#64748b" }}>{t("w6c.title.traceSn", locale)}</div>
        <input value={sn} onChange={e => setSn(e.target.value)} placeholder={t("sn.field.sn", locale)} style={{ ...inp, width: 200 }} />
        <button onClick={load} disabled={busy}>{t("snlist.search", locale)}</button>
      </div>
      <Err msg={err} />
      {meta && (
        <div style={box}>
          <div>{t("sn.field.sn", locale)}：{String(meta.sn ?? "")}&nbsp;&nbsp;{t("sn.field.mo_no", locale)}：{String(meta.mo_no ?? "")}&nbsp;&nbsp;{t("sn.field.product_code", locale)}：{String(meta.product_code ?? "")}</div>
        </div>
      )}
      <Table header={[t("sn.field.material_code", locale), t("sn.field.material_name", locale), t("sn.field.segment", locale),
        t("w6c.field.qty", locale), t("sn.field.unit", locale)]}
        rows={materials.map(r => ({
          material_code: r.material_code, material_name: r.material_name, segment: r.segment,
          qty: r.qty, unit: r.unit,
        } as Record<string, unknown>))} />
    </div>
  );
}

export function TraceMaterialByMaterialView({ locale }: { locale: Locale }) {
  const [materialCode, setMaterialCode] = useState("");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const load = async () => {
    if (!materialCode) return;
    setBusy(true);
    try { setRows(await mesrjApi.get<Record<string, unknown>[]>("/exec/trace/material/sns", { material_code: materialCode })); }
    catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
    finally { setBusy(false); }
  };
  return (
    <div>
      <div style={{ ...box, display: "flex", gap: 8, alignItems: "flex-end" }}>
        <div style={{ fontSize: 12, color: "#64748b" }}>{t("w6c.title.traceMaterial", locale)}</div>
        <input value={materialCode} onChange={e => setMaterialCode(e.target.value)} placeholder={t("sn.field.material_code", locale)} style={{ ...inp, width: 200 }} />
        <button onClick={load} disabled={busy}>{t("snlist.search", locale)}</button>
      </div>
      <Err msg={err} />
      <Table header={[t("sn.field.sn", locale), t("sn.field.mo_no", locale), t("sn.field.cur_station", locale), t("field.status", locale)]}
        rows={rows.map(r => ({
          sn: r.sn, mo_no: r.mo_no, cur_station: r.cur_station, status: r.status,
        } as Record<string, unknown>))} />
    </div>
  );
}
