// MES-ruijing W6b 前端 —— SN 池 / 批次 / 工位 / 过站列表 / 面板
// 源 api/exec.py 的发码、工位、过站记录、面板 11 个页面的移植。
// 路由（后端 services/api/src/routes/mesrj.js）：
//   GET  /exec/sn/pool      SN 池查询
//   GET  /exec/sn/batch     SN 批次汇总
//   POST /exec/sn/void      SN 作废
//   GET  /exec/sn/detail    SN 详情
//   GET  /exec/sn/test      SN 测试记录
//   GET  /exec/station/next 工位下一站
//   GET  /exec/station/pending 工位待处理
//   GET  /exec/pass/list    过站记录分页
//   GET  /exec/panel/preview 面板预览
//   GET  /exec/pass/panel   过站看板汇总
import { useCallback, useEffect, useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { mesrjApi, MesrjApiError, type MesrjPaged } from "./api";
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
              <th key={h} style={{ padding: "6px 8px", borderBottom: "1px solid var(--border, #e2e8f0)", textAlign: "left" }}>
                {h}
              </th>
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

export function SnPoolView({ locale }: { locale: Locale }) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const [kw, setKw] = useState("");
  const [moNo, setMoNo] = useState("");
  const [status, setStatus] = useState("");
  const [station, setStation] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const d = await mesrjApi.get<{ rows: unknown[]; total: number; page: number; size: number }>(
        "/exec/sn/pool", { page, size, mo_no: moNo, status, station_code: station, keyword: kw });
      setRows(d.rows as Record<string, unknown>[]); setTotal(d.total); setPage(d.page); setSize(d.size);
    } catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
    finally { setBusy(false); }
  }, [page, size, moNo, status, station, kw]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div style={{ ...box, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontSize: 12, color: "#64748b" }}>{t("snlist.pool", locale)}</div>
          <input value={kw} onChange={e => setKw(e.target.value)} placeholder={t("common.keyword", locale)}
            style={{ ...inp, width: 220 }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontSize: 12, color: "#64748b" }}>{t("sn.field.mo_no", locale)}</div>
          <input value={moNo} onChange={e => setMoNo(e.target.value)} placeholder={t("exec.scan.mo_ph", locale)}
            style={{ ...inp, width: 150 }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontSize: 12, color: "#64748b" }}>{t("field.status", locale)}</div>
          <input value={status} onChange={e => setStatus(e.target.value)} placeholder={t("sn.field.status", locale)}
            style={{ ...inp, width: 120 }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontSize: 12, color: "#64748b" }}>{t("sn.field.cur_station", locale)}</div>
          <input value={station} onChange={e => setStation(e.target.value)} placeholder={t("sn.field.station_code", locale)}
            style={{ ...inp, width: 120 }} />
        </div>
        <button onClick={load} disabled={busy}>{t("snlist.search", locale)}</button>
      </div>
      <Err msg={err} />
      <Table header={[t("sn.field.sn", locale), t("sn.field.product_code", locale), t("sn.field.mo_no", locale),
        t("sn.field.line_code", locale), t("sn.field.cur_station", locale), t("sn.field.status", locale),
        t("sn.field.created_at", locale)]} rows={rows.map(r => ({
        sn: r.sn, product_code: r.product_code, mo_no: r.mo_no, line_code: r.line_code,
        cur_station: r.cur_station, status: r.status, created_at: r.created_at,
      } as Record<string, unknown>))} />
      <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, color: "#64748b" }}>
        {t("common.total", locale)} {total} {t("common.items", locale)} &nbsp;
        <button disabled={page <= 1 || busy} onClick={() => setPage(p => p - 1)}>{t("common.prev", locale)}</button>
        <span>{page}</span>
        <button disabled={page * size >= total || busy} onClick={() => setPage(p => p + 1)}>{t("common.next", locale)}</button>
      </div>
    </div>
  );
}

export function SnBatchView({ locale }: { locale: Locale }) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [moNo, setMoNo] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    if (!moNo) return;
    setBusy(true);
    try { setRows(await mesrjApi.get<Record<string, unknown>[]>("/exec/sn/batch", { mo_no: moNo })); }
    catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
    finally { setBusy(false); }
  }, [moNo]);
  return (
    <div>
      <div style={{ ...box, display: "flex", gap: 8, alignItems: "flex-end" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontSize: 12, color: "#64748b" }}>{t("snlist.batch", locale)}</div>
          <input value={moNo} onChange={e => setMoNo(e.target.value)} placeholder={t("exec.scan.mo_ph", locale)}
            style={{ ...inp, width: 200 }} />
        </div>
        <button onClick={load} disabled={busy}>{t("snlist.search", locale)}</button>
      </div>
      <Err msg={err} />
      <Table header={[t("sn.field.mo_no", locale), t("sn.field.total", locale), t("sn.field.wip", locale),
        t("sn.field.done", locale), t("sn.field.scrapped", locale), t("sn.field.first_sn", locale), t("sn.field.last_sn", locale)]}
        rows={rows.map(r => ({
        mo_no: r.mo_no, sn_total: r.sn_total, wip: r.wip, done: r.done, scrapped: r.scrapped,
        first_sn: r.first_sn, last_sn: r.last_sn,
      } as Record<string, unknown>))} />
    </div>
  );
}

export function SnVoidView({ locale }: { locale: Locale }) {
  const [sn, setSn] = useState("");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sn) return setErr("SN 必填");
    if (!reason) return setErr("作废原因必填");
    setBusy(true);
    try {
      const d = await mesrjApi.post<{ msg?: string }>("/exec/sn/void", { sn, reason });
      setMsg(d?.msg || "已作废"); setReason("");
    } catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
    finally { setBusy(false); }
  };
  return (
    <div>
      <div style={box}>{t("snlist.void", locale)}</div>
      <form onSubmit={submit} style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontSize: 12, color: "#64748b" }}>{t("sn.field.sn", locale)}</div>
          <input value={sn} onChange={e => setSn(e.target.value)} placeholder={t("sn.field.sn", locale)}
            style={{ ...inp, width: 180 }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontSize: 12, color: "#64748b" }}>{t("sn.field.reason", locale)}</div>
          <input value={reason} onChange={e => setReason(e.target.value)} placeholder={t("sn.field.reason", locale)}
            style={{ ...inp, width: 260 }} />
        </div>
        <button type="submit" disabled={busy}>{t("snlist.void", locale)}</button>
      </form>
      <Err msg={err} /><Ok msg={msg} />
    </div>
  );
}

export function SnDetailView({ locale }: { locale: Locale }) {
  const [sn, setSn] = useState("");
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [passes, setPasses] = useState<Record<string, unknown>[]>([]);
  const [defects, setDefects] = useState<Record<string, unknown>[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const load = async () => {
    if (!sn) return;
    setBusy(true);
    try {
      const d = await mesrjApi.get<{ sn: Record<string, unknown>; passes: unknown[]; defects: unknown[] }>(
        "/exec/sn/detail", { sn });
      setDetail(d.sn); setPasses(d.passes as Record<string, unknown>[]); setDefects(d.defects as Record<string, unknown>[]);
    } catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
    finally { setBusy(false); }
  };
  return (
    <div>
      <div style={{ ...box, display: "flex", gap: 8, alignItems: "flex-end" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontSize: 12, color: "#64748b" }}>{t("snlist.detail", locale)}</div>
          <input value={sn} onChange={e => setSn(e.target.value)} placeholder={t("sn.field.sn", locale)}
            style={{ ...inp, width: 180 }} />
        </div>
        <button onClick={load} disabled={busy}>{t("snlist.search", locale)}</button>
      </div>
      <Err msg={err} />
      {detail && (
        <div style={box}>
          <Table header={[t("sn.field.sn", locale), t("sn.field.product_code", locale), t("sn.field.mo_no", locale),
            t("sn.field.line_code", locale), t("sn.field.cur_station", locale), t("sn.field.status", locale)]}
          rows={[detail]} />
        </div>
      )}
      <div style={box}>{t("sn.field.station_code", locale)} / {t("sn.field.pass_time", locale)} / {t("sn.field.mark", locale)}</div>
      <Table header={[t("sn.field.station_code", locale), t("sn.field.result", locale), t("sn.field.defect_code", locale),
        t("sn.field.pass_time", locale), t("sn.field.mark", locale)]} rows={passes.map(r => ({
        station_code: r.station_code, result: r.result, ng_code: r.ng_code, pass_time: r.pass_time, mark: r.mark,
      } as Record<string, unknown>))} />
      <div style={box}>{t("sn.field.defect_code", locale)} / {t("sn.field.station_code", locale)} / {t("sn.field.pass_time", locale)}</div>
      <Table header={[t("sn.field.defect_code", locale), t("sn.field.station_code", locale),
        t("sn.field.pass_time", locale)]} rows={defects.map(r => ({
        defect_code: r.defect_code, station_code: r.station_code, pass_time: r.defect_time,
      } as Record<string, unknown>))} />
    </div>
  );
}

export function SnTestView({ locale }: { locale: Locale }) {
  const [sn, setSn] = useState("");
  const [aoi, setAoi] = useState<Record<string, unknown>[]>([]);
  const [passes, setPasses] = useState<Record<string, unknown>[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const load = async () => {
    if (!sn) return;
    setBusy(true);
    try {
      const d = await mesrjApi.get<{ aoi: unknown[]; passes: unknown[] }>("/exec/sn/test", { sn });
      setAoi(d.aoi as Record<string, unknown>[]); setPasses(d.passes as Record<string, unknown>[]);
    } catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
    finally { setBusy(false); }
  };
  return (
    <div>
      <div style={{ ...box, display: "flex", gap: 8, alignItems: "flex-end" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontSize: 12, color: "#64748b" }}>{t("snlist.test", locale)}</div>
          <input value={sn} onChange={e => setSn(e.target.value)} placeholder={t("sn.field.sn", locale)}
            style={{ ...inp, width: 180 }} />
        </div>
        <button onClick={load} disabled={busy}>{t("snlist.search", locale)}</button>
      </div>
      <Err msg={err} />
      <div style={box}>{t("sn.field.aoi", locale)}</div>
      <Table header={[t("sn.field.station_code", locale), t("sn.field.pass_time", locale)]} rows={aoi.map(r => ({
        station_code: r.device_name, pass_time: r.test_time, defect_code: r.final_result,
      } as Record<string, unknown>))} />
      <div style={box}>{t("sn.field.station_code", locale)} / {t("sn.field.pass_time", locale)} / {t("sn.field.mark", locale)}</div>
      <Table header={[t("sn.field.station_code", locale), t("sn.field.result", locale), t("sn.field.pass_time", locale),
        t("sn.field.mark", locale)]} rows={passes.map(r => ({
        station_code: r.station_code, result: r.result, pass_time: r.pass_time, mark: r.mark,
      } as Record<string, unknown>))} />
    </div>
  );
}

export function StationNextView({ locale }: { locale: Locale }) {
  const [sn, setSn] = useState("");
  const [stationCode, setStationCode] = useState("");
  const [result, setResult] = useState<{ next_station: Record<string, unknown> | null } | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const load = async () => {
    if (!sn) return;
    setBusy(true);
    try {
      const d = await mesrjApi.get<{ next_station: Record<string, unknown> | null }>(
        "/exec/station/next", { sn, station_code: stationCode || undefined });
      setResult(d);
    } catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
    finally { setBusy(false); }
  };
  return (
    <div>
      <div style={{ ...box, display: "flex", gap: 8, alignItems: "flex-end" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontSize: 12, color: "#64748b" }}>{t("stationlist.next", locale)}</div>
          <input value={sn} onChange={e => setSn(e.target.value)} placeholder={t("sn.field.sn", locale)}
            style={{ ...inp, width: 180 }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontSize: 12, color: "#64748b" }}>{t("sn.field.station_code", locale)}</div>
          <input value={stationCode} onChange={e => setStationCode(e.target.value)}
            placeholder={t("sn.field.station_code", locale)} style={{ ...inp, width: 150 }} />
        </div>
        <button onClick={load} disabled={busy}>{t("snlist.search", locale)}</button>
      </div>
      <Err msg={err} />
      {result && (
        <div style={box}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{t("sn.field.next_station", locale)}：
            {result.next_station ? `${result.next_station.station_code} ${result.next_station.station_name}` : "（无）"}</div>
        </div>
      )}
    </div>
  );
}

export function StationPendingView({ locale }: { locale: Locale }) {
  const [stationCode, setStationCode] = useState("");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const load = async () => {
    if (!stationCode) return;
    setBusy(true);
    try { setRows(await mesrjApi.get<Record<string, unknown>[]>("/exec/station/pending", { station_code: stationCode })); }
    catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
    finally { setBusy(false); }
  };
  return (
    <div>
      <div style={{ ...box, display: "flex", gap: 8, alignItems: "flex-end" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontSize: 12, color: "#64748b" }}>{t("stationlist.pending", locale)}</div>
          <input value={stationCode} onChange={e => setStationCode(e.target.value)}
            placeholder={t("sn.field.station_code", locale)} style={{ ...inp, width: 180 }} />
        </div>
        <button onClick={load} disabled={busy}>{t("snlist.search", locale)}</button>
      </div>
      <Err msg={err} />
      <Table header={[t("sn.field.sn", locale), t("sn.field.product_code", locale), t("sn.field.mo_no", locale),
        t("sn.field.cur_station", locale), t("sn.field.status", locale), t("sn.field.created_at", locale)]}
        rows={rows.map(r => ({
        sn: r.sn, product_code: r.product_code, mo_no: r.mo_no, cur_station: r.cur_station,
        status: r.status, created_at: r.created_at,
      } as Record<string, unknown>))} />
    </div>
  );
}

export function PassListView({ locale }: { locale: Locale }) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const [sn, setSn] = useState("");
  const [moNo, setMoNo] = useState("");
  const [stationCode, setStationCode] = useState("");
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const load = useCallback(async () => {
    setBusy(true);
    try {
      const d = await mesrjApi.get<{ rows: unknown[]; total: number }>(
        "/exec/pass/list", { page, size, sn, mo_no: moNo, station_code: stationCode, result });
      setRows(d.rows as Record<string, unknown>[]); setTotal(d.total);
    } catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
    finally { setBusy(false); }
  }, [page, size, sn, moNo, stationCode, result]);
  useEffect(() => { load(); }, [load]);
  return (
    <div>
      <div style={{ ...box, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontSize: 12, color: "#64748b" }}>{t("passlist.title", locale)}</div>
          <input value={sn} onChange={e => setSn(e.target.value)} placeholder={t("sn.field.sn", locale)}
            style={{ ...inp, width: 150 }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontSize: 12, color: "#64748b" }}>{t("sn.field.mo_no", locale)}</div>
          <input value={moNo} onChange={e => setMoNo(e.target.value)} style={{ ...inp, width: 150 }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontSize: 12, color: "#64748b" }}>{t("sn.field.station_code", locale)}</div>
          <input value={stationCode} onChange={e => setStationCode(e.target.value)} style={{ ...inp, width: 120 }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontSize: 12, color: "#64748b" }}>{t("field.status", locale)}</div>
          <input value={result} onChange={e => setResult(e.target.value)} style={{ ...inp, width: 100 }} />
        </div>
        <button onClick={load} disabled={busy}>{t("snlist.search", locale)}</button>
      </div>
      <Err msg={err} />
      <Table header={[t("sn.field.station_code", locale), t("sn.field.result", locale), t("sn.field.defect_code", locale),
        t("sn.field.pass_time", locale), t("sn.field.mark", locale)]} rows={rows.map(r => ({
        station_code: r.station_code, result: r.result, ng_code: r.ng_code, pass_time: r.pass_time, mark: r.mark,
      } as Record<string, unknown>))} />
      <div style={{ fontSize: 12, color: "#64748b", marginTop: 6 }}>{t("common.total", locale)} {total}</div>
    </div>
  );
}

export function PanelPreviewView({ locale }: { locale: Locale }) {
  const [stationCode, setStationCode] = useState("");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const load = async () => {
    if (!stationCode) return;
    setBusy(true);
    try { setRows(await mesrjApi.get<Record<string, unknown>[]>("/exec/panel/preview", { station_code: stationCode })); }
    catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
    finally { setBusy(false); }
  };
  return (
    <div>
      <div style={{ ...box, display: "flex", gap: 8, alignItems: "flex-end" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontSize: 12, color: "#64748b" }}>{t("panelpreview.title", locale)}</div>
          <input value={stationCode} onChange={e => setStationCode(e.target.value)}
            placeholder={t("sn.field.station_code", locale)} style={{ ...inp, width: 180 }} />
        </div>
        <button onClick={load} disabled={busy}>{t("snlist.search", locale)}</button>
      </div>
      <Err msg={err} />
      <Table header={[t("sn.field.panel_key", locale), t("sn.field.panel_type", locale), t("sn.field.config_json", locale)]}
        rows={rows.map(r => ({
        panel_key: r.panel_key, panel_type: r.panel_type, config_json: r.config_json,
      } as Record<string, unknown>))} />
    </div>
  );
}

export function PassPanelView({ locale }: { locale: Locale }) {
  const [lineCode, setLineCode] = useState("");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setBusy(true);
    try { setRows(await mesrjApi.get<Record<string, unknown>[]>("/exec/pass/panel", { line_code: lineCode || undefined })); }
    catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
    finally { setBusy(false); }
  };
  useEffect(() => { load(); }, [lineCode]);
  return (
    <div>
      <div style={{ ...box, display: "flex", gap: 8, alignItems: "flex-end" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontSize: 12, color: "#64748b" }}>{t("passpanel.title", locale)}</div>
          <input value={lineCode} onChange={e => setLineCode(e.target.value)} placeholder={t("sn.field.line_code", locale)}
            style={{ ...inp, width: 180 }} />
        </div>
      </div>
      <Err msg={err} />
      <Table header={[t("sn.field.station_code", locale), t("station.field.station_name", locale), t("sn.field.line_code", locale),
        t("sn.field.pass_ok", locale), t("sn.field.pass_ng", locale), t("sn.field.sn_total", locale)]}
        rows={rows.map(r => ({
        station_code: r.station_code, station_name: r.station_name, line_code: r.line_code,
        pass_ok: r.pass_ok, pass_ng: r.pass_ng, sn_total: r.sn_total,
      } as Record<string, unknown>))} />
    </div>
  );
}
