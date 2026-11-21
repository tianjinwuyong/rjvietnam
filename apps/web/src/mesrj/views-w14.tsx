// MES-ruijing W14 前端 —— 绑码 / 解码（源 api/bind.py + web/pages.js「绑码」「解码」页）
// 路由（后端 services/api/src/routes/mesrj.js）：
//   GET  /bind/init  /bind/rule  /bind/list  /bind/chain  /bind/hourly  /bind/lookup  /bind/decode/log
//   POST /bind/precheck  /bind/do  /bind/unbind  /bind/decode
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
function Table({ header, rows }: { header: [string, string][]; rows: Record<string, unknown>[] }) {
  if (!rows.length) return <div style={{ color: "#94a3b8", fontSize: 13 }}>No data</div>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr>
            {header.map(([k, label]) => (
              <th key={k} style={{ padding: "6px 8px", borderBottom: "1px solid var(--border, #e2e8f0)", textAlign: "left" }}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderBottom: "1px solid #f1f5f9" }}>
              {header.map(([k]) => <td key={k} style={{ padding: "5px 8px" }}>{String(r[k] ?? "")}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface BindSide { label?: string; hint?: string; sn_type?: string; check_len?: number; prefix?: string; regex?: string; auto_create?: number }
interface BindStation {
  station_code: string; station_name?: string; rel_type?: string; line_code?: string;
  old: BindSide; new: BindSide; auto_pass?: number;
}
interface Init { stations: BindStation[]; mo_list: Record<string, unknown>[]; sn_types: string[] }

export function BindView({ locale }: { locale: Locale }) {
  const [init, setInit] = useState<Init | null>(null);
  const [stationCode, setStationCode] = useState("");
  const [oldSn, setOldSn] = useState("");
  const [newSn, setNewSn] = useState("");
  const [moNo, setMoNo] = useState("");
  const [state, setState] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState<Record<string, unknown>[]>([]);

  const st: BindStation | undefined = (init?.stations || []).find(s => s.station_code === stationCode);

  const load = useCallback(async () => {
    try {
      const d = await mesrjApi.get<Init>("/bind/init");
      setInit(d);
      if (d.stations?.length) setStationCode(prev => prev || d.stations[0].station_code);
    } catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
  }, []);
  const loadRecent = useCallback(async () => {
    try {
      const d = await mesrjApi.get<{ rows: Record<string, unknown>[] }>("/bind/list", { is_active: 1, size: 20 });
      setRecent(d.rows || []);
    } catch { /* 列表失败不影响主流程 */ }
  }, []);
  useEffect(() => { load(); loadRecent(); }, [load, loadRecent]);

  const precheck = async () => {
    setErr(""); setMsg(""); setState("");
    try {
      const r = await mesrjApi.post<{ state: string; accepted: boolean; msg: string }>("/bind/precheck",
        { sn: oldSn, station_code: stationCode });
      setState(r.state);
      if (!r.accepted) setErr(r.msg); else setMsg(r.msg);
    } catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
  };

  const doBind = async () => {
    setErr(""); setMsg("");
    try {
      const r = await mesrjApi.post<{ msg?: string }>("/bind/do",
        { station_code: stationCode, old_sn: oldSn, new_sn: newSn, mo_no: moNo });
      setMsg(r.msg || t("bind.msg.ok", locale));
      setOldSn(""); setNewSn(""); setState("");
      await loadRecent();
    } catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
  };

  if (!init && !err) return <div style={{ color: "#94a3b8", fontSize: 13 }}>{t("loading", locale)}</div>;

  return (
    <div>
      <div style={box}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>{t("bind.title", locale)}</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "flex-end", marginBottom: 10 }}>
          <select value={stationCode} onChange={e => { setStationCode(e.target.value); setState(""); }} style={inp}>
            {(init?.stations || []).map(s => (
              <option key={s.station_code} value={s.station_code}>
                {s.station_name || s.station_code}（{s.rel_type}）
              </option>
            ))}
          </select>
          <select value={moNo} onChange={e => setMoNo(e.target.value)} style={inp}>
            <option value="">{t("bind.field.mo", locale)}</option>
            {(init?.mo_list || []).map(m => (
              <option key={String(m.mo_no)} value={String(m.mo_no)}>{String(m.mo_no)} · {String(m.product_code || "")}</option>
            ))}
          </select>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "flex-end", marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 12, color: "#64748b" }}>{st?.old?.label || t("bind.field.old", locale)}</div>
            <input value={oldSn} onChange={e => setOldSn(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") precheck(); }}
              placeholder={st?.old?.hint || ""} style={{ ...inp, width: 240 }} autoFocus />
          </div>
          <div>
            <div style={{ fontSize: 12, color: "#64748b" }}>{st?.new?.label || t("bind.field.new", locale)}</div>
            <input value={newSn} onChange={e => setNewSn(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") doBind(); }}
              placeholder={st?.new?.hint || ""} style={{ ...inp, width: 240 }} />
          </div>
          <button onClick={precheck} disabled={busy}>{t("bind.btn.precheck", locale)}</button>
          <button onClick={doBind} disabled={!oldSn || !newSn || busy}>{t("bind.btn.do", locale)}</button>
          {state ? <span style={{ fontSize: 12, color: state === "OK" || state === "NEW" ? "#15803d" : "#b91c1c" }}>{state}</span> : null}
        </div>
        <Err msg={err} />
        <Ok msg={msg} />
        <div style={{ fontSize: 12, color: "#64748b" }}>
          {t("bind.hint.flow", locale)}
        </div>
      </div>

      <div style={box}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>{t("bind.title.recent", locale)}</div>
        <Table
          header={[
            ["parent_sn", t("bind.field.old", locale)],
            ["child_sn", t("bind.field.new", locale)],
            ["rel_type", t("bind.field.relType", locale)],
            ["station", t("sn.field.station_code", locale)],
            ["operator", t("bind.field.operator", locale)],
            ["created_at", t("sn.field.created_at", locale)],
          ]}
          rows={recent}
        />
      </div>
    </div>
  );
}

interface Lookup {
  sn: string; codes: Record<string, unknown>[]; rels: Record<string, unknown>[];
  history: Record<string, unknown>[]; reasons: string[]; found: boolean;
  panel_hint?: string; resume_old?: string; resume_hint?: string;
}

export function DecodeView({ locale }: { locale: Locale }) {
  const [sn, setSn] = useState("");
  const [data, setData] = useState<Lookup | null>(null);
  const [reason, setReason] = useState("");
  const [remark, setRemark] = useState("");
  const [voidCodes, setVoidCodes] = useState<string[]>([]);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [log, setLog] = useState<Record<string, unknown>[]>([]);

  const loadLog = useCallback(async () => {
    try { setLog((await mesrjApi.get<{ rows: Record<string, unknown>[] }>("/bind/decode/log")).rows || []); }
    catch { /* 履历失败不影响主流程 */ }
  }, []);
  useEffect(() => { loadLog(); }, [loadLog]);

  const lookup = async () => {
    if (!sn) return;
    setErr(""); setMsg(""); setData(null); setVoidCodes([]);
    try {
      const d = await mesrjApi.get<Lookup>("/bind/lookup", { sn });
      setData(d);
      if (d.resume_old) { /* 反查出来的原 PCBA，留给绑码页用 */ }
    } catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
  };

  const decode = async () => {
    if (!data) return;
    setErr(""); setMsg("");
    try {
      const r = await mesrjApi.post<{ msg?: string }>("/bind/decode",
        { sn, rel_ids: (data.rels || []).map(x => Number(x.id)), void_codes: voidCodes, reason, remark });
      setMsg(r.msg || t("decode.msg.ok", locale));
      await lookup(); await loadLog();
    } catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
  };

  const toggleVoid = (code: string) =>
    setVoidCodes(prev => prev.includes(code) ? prev.filter(x => x !== code) : [...prev, code]);

  return (
    <div>
      <div style={box}>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{t("decode.title", locale)}</div>
          <input value={sn} onChange={e => setSn(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") lookup(); }}
            placeholder={t("sn.field.sn", locale)} style={{ ...inp, width: 240 }} autoFocus />
          <button onClick={lookup}>{t("snlist.search", locale)}</button>
        </div>
        <Err msg={err} />
        <Ok msg={msg} />
        {data?.resume_hint ? <div style={{ fontSize: 12, color: "#b45309" }}>{data.resume_hint}</div> : null}
        {data?.panel_hint ? <div style={{ fontSize: 12, color: "#64748b" }}>{data.panel_hint}</div> : null}
        {data ? (
          <>
            <Table
              header={[
                ["sn", t("sn.field.sn", locale)], ["sn_type", t("bind.field.snType", locale)],
                ["status", t("field.status", locale)], ["mo_no", t("sn.field.mo_no", locale)],
                ["box_no", t("bind.field.box", locale)], ["pallet_no", t("bind.field.pallet", locale)],
              ]}
              rows={(data.codes || []).map(x => ({
                ...x, sn: `${voidCodes.includes(String(x.sn)) ? "☑ " : ""}${String(x.sn)}`,
              }))}
            />
            <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 10, fontSize: 12 }}>
              {(data.codes || []).map(x => (
                <label key={String(x.sn)} style={{ marginRight: 6 }}>
                  <input type="checkbox" checked={voidCodes.includes(String(x.sn))}
                    onChange={() => toggleVoid(String(x.sn))} /> {String(x.sn)}（{t("decode.btn.void", locale)}）
                </label>
              ))}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10, alignItems: "flex-end" }}>
              <select value={reason} onChange={e => setReason(e.target.value)} style={inp}>
                <option value="">{t("decode.field.reason", locale)}</option>
                {(data.reasons || []).map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              <input value={remark} onChange={e => setRemark(e.target.value)}
                placeholder={t("dwell.field.remark", locale)} style={{ ...inp, width: 200 }} />
              <button onClick={decode}>{t("decode.btn.go", locale)}</button>
            </div>
            <div style={{ marginTop: 10, fontSize: 13, fontWeight: 600 }}>{t("decode.title.rels", locale)}</div>
            <Table
              header={[
                ["label", t("decode.field.rel", locale)], ["rel_type", t("bind.field.relType", locale)],
                ["station", t("sn.field.station_code", locale)], ["operator", t("bind.field.operator", locale)],
                ["created_at", t("sn.field.created_at", locale)],
              ]}
              rows={data.rels || []}
            />
            <div style={{ marginTop: 10, fontSize: 13, fontWeight: 600 }}>{t("decode.title.history", locale)}</div>
            <Table
              header={[
                ["parent_sn", t("bind.field.old", locale)], ["child_sn", t("bind.field.new", locale)],
                ["rel_type", t("bind.field.relType", locale)], ["reason", t("decode.field.reason", locale)],
                ["void_at", t("decode.field.voidAt", locale)], ["void_by", t("decode.field.voidBy", locale)],
              ]}
              rows={data.history || []}
            />
          </>
        ) : null}
      </div>

      <div style={box}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>{t("decode.title.log", locale)}</div>
        <Table
          header={[
            ["created_at", t("sn.field.created_at", locale)], ["action", t("decode.field.action", locale)],
            ["sn", t("sn.field.sn", locale)], ["parent_sn", t("bind.field.old", locale)],
            ["child_sn", t("bind.field.new", locale)], ["void_sn", t("decode.field.voidSn", locale)],
            ["reason", t("decode.field.reason", locale)], ["operator", t("bind.field.operator", locale)],
          ]}
          rows={log}
        />
      </div>
    </div>
  );
}
