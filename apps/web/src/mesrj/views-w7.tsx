// MES-ruijing W7 前端 —— 设备接口（DeviceConfig / StationPass / MachineData / Packing / itf 日志）
// 路由（后端 services/api/src/routes/mesrj.js，设备侧走 X-Api-Key；itf 日志走 JWT）：
//   GET   /DeviceConfig/LineConfig
//   POST  /StationPass/Scan
//   GET   /StationPass/Pending
//   POST  /MachineData/Upload
//   GET   /MachineData/List
//   GET   /MachineData/BySn
//   POST  /Packing/Box
//   POST  /Packing/Pallet
//   GET   /Packing/Box/:box_no
//   GET   /Packing/Pallet/:pallet_no
//   GET   /itf/api/log
import { useCallback, useEffect, useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { mesrjApi } from "./api";
import { apiBase } from "../api/client";
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

// ── 设备侧 API（X-Api-Key，不走 JWT）────────────────────────────────────────
async function deviceRequest(method: string, path: string, apiKey: string, body?: unknown) {
  const res = await fetch(`${apiBase}/api/mesrj${path}`, {
    method,
    headers: { "X-Api-Key": apiKey, "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.msg || `HTTP ${res.status}`);
  return json?.data ?? json;
}

function ApiKeyInput({ apiKey, setApiKey }: { apiKey: string; setApiKey: (v: string) => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ fontSize: 12, color: "#64748b" }}>{t("w7.field.api_key", "zh" as Locale)}</div>
      <input value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={t("w7.field.api_key_hint", "zh" as Locale)} style={{ ...inp, width: 260 }} />
    </div>
  );
}

// ── DeviceConfig：线别/工位配置 ──
export function DeviceConfigView({ locale }: { locale: Locale }) {
  const [apiKey, setApiKey] = useState("");
  const [lineCode, setLineCode] = useState("");
  const [stationCode, setStationCode] = useState("");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!apiKey) return;
    setBusy(true);
    try {
      const qs = new URLSearchParams();
      if (lineCode) qs.set("line_code", lineCode);
      if (stationCode) qs.set("station_code", stationCode);
      const data = await deviceRequest("GET", `/DeviceConfig/LineConfig?${qs}`, apiKey);
      setRows(Array.isArray(data) ? data : []);
    } catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
    finally { setBusy(false); }
  }, [apiKey, lineCode, stationCode]);

  return (
    <div>
      <div style={{ ...box, display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div style={{ fontSize: 12, color: "#64748b" }}>{t("w7.title.deviceConfig", locale)}</div>
        <ApiKeyInput apiKey={apiKey} setApiKey={setApiKey} />
        <input value={lineCode} onChange={e => setLineCode(e.target.value)} placeholder={t("sn.field.line_code", locale)} style={{ ...inp, width: 140 }} />
        <input value={stationCode} onChange={e => setStationCode(e.target.value)} placeholder={t("sn.field.station_code", locale)} style={{ ...inp, width: 140 }} />
        <button onClick={load} disabled={busy || !apiKey}>{t("snlist.search", locale)}</button>
      </div>
      <Err msg={err} /><Ok msg={msg} />
      <Table header={[t("sn.field.line_code", locale), t("sn.field.line_name", locale), t("sn.field.station_code", locale),
        t("station.field.station_name", locale), t("sn.field.type_code", locale), t("sn.field.process_code", locale),
        t("sn.field.seq_no", locale)]}
        rows={rows.map(r => ({ line_code: r.line_code, line_name: r.line_name, station_code: r.station_code,
          station_name: r.station_name, type_code: r.type_code, process_code: r.process_code, seq_no: r.seq_no } as Record<string, unknown>))} />
    </div>
  );
}

// ── StationPass：机台扫码过站 ──
export function StationPassView({ locale }: { locale: Locale }) {
  const [apiKey, setApiKey] = useState("");
  const [sn, setSn] = useState("");
  const [station, setStation] = useState("");
  const [machine, setMachine] = useState("");
  const [result, setResult] = useState("OK");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const scan = async () => {
    if (!sn) return setErr("SN 必填");
    if (!station) return setErr("工位必填");
    setBusy(true);
    try {
      const d = await deviceRequest("POST", "/StationPass/Scan", apiKey, { sn, station_code: station, machine_no: machine, result });
      setMsg(d?.msg || "扫码过站完成");
      setSn("");
    } catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
    finally { setBusy(false); }
  };

  const loadPending = useCallback(async () => {
    if (!apiKey) return;
    setBusy(true);
    try {
      const qs = new URLSearchParams();
      if (station) qs.set("station_code", station);
      const data = await deviceRequest("GET", `/StationPass/Pending?${qs}`, apiKey);
      setRows(Array.isArray(data) ? data : []);
    } catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
    finally { setBusy(false); }
  }, [apiKey, station]);

  useEffect(() => { loadPending(); }, [loadPending]);

  return (
    <div>
      <div style={{ ...box, display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div style={{ fontSize: 12, color: "#64748b" }}>{t("w7.title.stationPass", locale)}</div>
        <ApiKeyInput apiKey={apiKey} setApiKey={setApiKey} />
        <input value={sn} onChange={e => setSn(e.target.value)} placeholder={t("sn.field.sn", locale)} style={{ ...inp, width: 160 }} />
        <input value={station} onChange={e => setStation(e.target.value)} placeholder={t("sn.field.station_code", locale)} style={{ ...inp, width: 130 }} />
        <input value={machine} onChange={e => setMachine(e.target.value)} placeholder={t("w7.field.machine_no", locale)} style={{ ...inp, width: 130 }} />
        <select value={result} onChange={e => setResult(e.target.value)} style={{ ...inp, width: 90 }}>
          <option value="OK">OK</option>
          <option value="NG">NG</option>
        </select>
        <button onClick={scan} disabled={busy || !apiKey}>{t("w7.action.scan", locale)}</button>
        <button onClick={loadPending} disabled={busy || !apiKey}>{t("snlist.search", locale)}</button>
      </div>
      <Err msg={err} /><Ok msg={msg} />
      <Table header={[t("sn.field.sn", locale), t("sn.field.product_code", locale), t("sn.field.mo_no", locale),
        t("sn.field.station_code", locale), t("sn.field.cur_seq", locale), t("field.status", locale), t("sn.field.created_at", locale)]}
        rows={rows.map(r => ({ sn: r.sn, product_code: r.product_code, mo_no: r.mo_no, station_code: r.station_code,
          cur_seq: r.cur_seq, status: r.status, created_at: r.created_at } as Record<string, unknown>))} />
    </div>
  );
}

// ── MachineData：机台测试数据 ──
export function MachineDataView({ locale }: { locale: Locale }) {
  const [apiKey, setApiKey] = useState("");
  const [sn, setSn] = useState("");
  const [machineNo, setMachineNo] = useState("");
  const [stationCode, setStationCode] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!apiKey) return;
    setBusy(true);
    try {
      const qs = new URLSearchParams({ page: String(page), size: "20" });
      if (sn) qs.set("sn", sn);
      if (machineNo) qs.set("machine_no", machineNo);
      if (stationCode) qs.set("station_code", stationCode);
      const data = await deviceRequest("GET", `/MachineData/List?${qs}`, apiKey);
      setRows(data?.rows ?? []);
      setTotal(data?.total ?? 0);
    } catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
    finally { setBusy(false); }
  }, [apiKey, sn, machineNo, stationCode, page]);

  useEffect(() => { load(); }, [load]);

  const upload = async () => {
    if (!sn) return setErr("SN 必填");
    setBusy(true);
    try {
      await deviceRequest("POST", "/MachineData/Upload", apiKey, {
        sn, machine_no: machineNo, station_code: stationCode,
        product_no: "", version: "", lot_no: "", loader_no: "",
        line_sn: "", track: "1", mo_no: "", seq: "",
        begin_time: "", end_time: "", location: "", channel: "",
        pass_ng: "OK", ng_info: "", create_by: machineNo || "device",
      });
      setMsg("机台数据上报完成");
      setSn("");
    } catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <div style={{ ...box, display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div style={{ fontSize: 12, color: "#64748b" }}>{t("w7.title.machineData", locale)}</div>
        <ApiKeyInput apiKey={apiKey} setApiKey={setApiKey} />
        <input value={sn} onChange={e => setSn(e.target.value)} placeholder={t("sn.field.sn", locale)} style={{ ...inp, width: 160 }} />
        <input value={machineNo} onChange={e => setMachineNo(e.target.value)} placeholder={t("w7.field.machine_no", locale)} style={{ ...inp, width: 130 }} />
        <input value={stationCode} onChange={e => setStationCode(e.target.value)} placeholder={t("sn.field.station_code", locale)} style={{ ...inp, width: 130 }} />
        <button onClick={upload} disabled={busy || !apiKey}>{t("w7.action.upload", locale)}</button>
        <button onClick={load} disabled={busy || !apiKey}>{t("snlist.search", locale)}</button>
      </div>
      <Err msg={err} /><Ok msg={msg} />
      <Table header={[t("sn.field.sn", locale), t("w7.field.machine_no", locale), t("w7.field.machine_type", locale),
        t("sn.field.station_code", locale), t("sn.field.mo_no", locale), t("w7.field.pass_ng", locale), t("sn.field.created_at", locale)]}
        rows={rows.map(r => ({ sn: r.sn, machine_no: r.machine_no, machine_type: r.machine_type, station_code: r.station_code,
          mo_no: r.mo_no, pass_ng: r.pass_ng, created_at: r.created_at } as Record<string, unknown>))} />
      <div style={{ fontSize: 12, color: "#64748b", marginTop: 6 }}>{t("common.total", locale)} {total}</div>
    </div>
  );
}

// ── Packing：装箱 / 建托 ──
export function PackingView({ locale }: { locale: Locale }) {
  const [apiKey, setApiKey] = useState("");
  const [boxNo, setBoxNo] = useState("");
  const [palletNo, setPalletNo] = useState("");
  const [sn, setSn] = useState("");
  const [moNo, setMoNo] = useState("");
  const [productCode, setProductCode] = useState("");
  const [lineCode, setLineCode] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const boxAction = async () => {
    if (!boxNo) return setErr("箱号必填");
    setBusy(true);
    try {
      await deviceRequest("POST", "/Packing/Box", apiKey, { box_no: boxNo, sn, mo_no: moNo, product_code: productCode });
      setMsg("装箱完成");
    } catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
    finally { setBusy(false); }
  };

  const palletAction = async () => {
    if (!palletNo) return setErr("托号必填");
    setBusy(true);
    try {
      await deviceRequest("POST", "/Packing/Pallet", apiKey, { pallet_no: palletNo, box_no: boxNo, mo_no: moNo, line_code: lineCode });
      setMsg("建托完成");
    } catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <div style={{ ...box, display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div style={{ fontSize: 12, color: "#64748b" }}>{t("w7.title.packing", locale)}</div>
        <ApiKeyInput apiKey={apiKey} setApiKey={setApiKey} />
        <input value={boxNo} onChange={e => setBoxNo(e.target.value)} placeholder={t("w7.field.box_no", locale)} style={{ ...inp, width: 150 }} />
        <input value={sn} onChange={e => setSn(e.target.value)} placeholder={t("sn.field.sn", locale)} style={{ ...inp, width: 150 }} />
        <input value={moNo} onChange={e => setMoNo(e.target.value)} placeholder={t("sn.field.mo_no", locale)} style={{ ...inp, width: 130 }} />
        <input value={productCode} onChange={e => setProductCode(e.target.value)} placeholder={t("sn.field.product_code", locale)} style={{ ...inp, width: 130 }} />
        <button onClick={boxAction} disabled={busy || !apiKey}>{t("w7.action.box", locale)}</button>
      </div>
      <div style={{ ...box, display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", marginTop: 8 }}>
        <div style={{ fontSize: 12, color: "#64748b" }}>{t("w7.title.pallet", locale)}</div>
        <input value={palletNo} onChange={e => setPalletNo(e.target.value)} placeholder={t("w7.field.pallet_no", locale)} style={{ ...inp, width: 150 }} />
        <input value={lineCode} onChange={e => setLineCode(e.target.value)} placeholder={t("sn.field.line_code", locale)} style={{ ...inp, width: 130 }} />
        <button onClick={palletAction} disabled={busy || !apiKey}>{t("w7.action.pallet", locale)}</button>
      </div>
      <Err msg={err} /><Ok msg={msg} />
    </div>
  );
}

// ── itf 日志 ──
export function ItfLogView({ locale }: { locale: Locale }) {
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const [apiPath, setApiPath] = useState("");
  const [success, setSuccess] = useState("");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const d = await mesrjApi.get<{ total: number; page: number; size: number; rows: Record<string, unknown>[] }>(
        "/itf/api/log", { api_path: apiPath || undefined, success: success || undefined, page, size });
      setRows(d.rows); setTotal(d.total);
    } catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
    finally { setBusy(false); }
  }, [page, size, apiPath, success]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div style={{ ...box, display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div style={{ fontSize: 12, color: "#64748b" }}>{t("w7.title.itfLog", locale)}</div>
        <input value={apiPath} onChange={e => setApiPath(e.target.value)} placeholder={t("w7.field.api_path", locale)} style={{ ...inp, width: 160 }} />
        <select value={success} onChange={e => setSuccess(e.target.value)} style={{ ...inp, width: 100 }}>
          <option value="">{t("w7.field.all", locale)}</option>
          <option value="1">{t("w7.field.success", locale)}</option>
          <option value="0">{t("w7.field.fail", locale)}</option>
        </select>
        <button onClick={load} disabled={busy}>{t("snlist.search", locale)}</button>
      </div>
      <Err msg={err} />
      <Table header={[t("w7.field.direction", locale), t("w7.field.api_path", locale), t("w7.field.method", locale),
        t("w7.field.http_status", locale), t("w7.field.success", locale), t("w7.field.cost_ms", locale),
        t("sn.field.sn", locale), t("sn.field.created_at", locale)]}
        rows={rows.map(r => ({ direction: r.direction, api_path: r.api_path, method: r.method,
          http_status: r.http_status, success: r.success === 1 ? "是" : "否", cost_ms: r.cost_ms,
          sn: r.sn, created_at: r.created_at } as Record<string, unknown>))} />
      <div style={{ fontSize: 12, color: "#64748b", marginTop: 6 }}>{t("common.total", locale)} {total}</div>
    </div>
  );
}
