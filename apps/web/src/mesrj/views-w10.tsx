// MES-ruijing W10 前端 —— 辅料管控（锡膏/红胶 · 钢网 · 刮刀 · 按工单追溯）
//                        + SMT 站位绑码 + 辅料时间参数
// 后端路由（services/api/src/routes/mesrj.js，源 api/smta.py 31 路由）：
//   GET  /smta/overview                    四块辅料预警总览
//   GET  /smta/paste                       锡膏/红胶台账（kw/ptype/only_warn）
//   POST /smta/paste                       新增/更新批次
//   POST /smta/paste/warm                  回温开始 / 回温结束（判定达标）
//   POST /smta/paste/use                   上线使用 / 下线回收（USE/RECOVER）
//   GET  /smta/paste/logs                  回温使用流水
//   GET  /smta/stencil                     钢网台账（寿命按印刷次数）
//   POST /smta/stencil                     新增/更新钢网
//   POST /smta/stencil/use                 记一次印刷（累加寿命）
//   GET  /smta/squeegee                    刮刀台账 + 当前上机
//   POST /smta/squeegee                    新增/更新刮刀
//   POST /smta/squeegee/online             上机（机台 + 位置 前/后）
//   POST /smta/squeegee/offline            下机（可记本轮次数）
//   POST /smta/squeegee/use                记使用次数
//   GET/POST/DELETE /smta/slots[/import|/export]   SMT 站位绑码
//   GET/POST /smta/times                   工艺阈值 + 辅料时间参数
//   GET/POST/DELETE /smta/stencil/params   钢网印刷参数（拼版数/每版次数）
//   GET  /smta/stencil/usage               按工单算钢网消耗
//   GET  /smta/print/log | /smta/print/stat | POST /smta/print/rescan
//   GET  /smta/pda/scan | /smta/pda/mos | /smta/trace/mo
import { useCallback, useEffect, useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { mesrjApi, mesrjMsg, MesrjApiError } from "./api";
import { t } from "./i18n";

const box = { border: "1px solid var(--border, #e2e8f0)", borderRadius: 10, padding: 14, marginBottom: 14 } as const;
const inp = { padding: "6px 8px", marginRight: 6, border: "1px solid var(--border, #e2e8f0)", borderRadius: 6 } as const;
const btn = { padding: "6px 12px", marginRight: 6, borderRadius: 6, border: "1px solid var(--border, #e2e8f0)", background: "#fff", cursor: "pointer" } as const;
const btnPrim = { ...btn, background: "#2563eb", color: "#fff", borderColor: "#2563eb" } as const;
const btnWarn = { ...btn, background: "#b45309", color: "#fff", borderColor: "#b45309" } as const;
const th = { padding: "8px 6px", textAlign: "left" as const, borderBottom: "2px solid var(--border, #e2e8f0)", fontSize: 13 };
const td = { padding: "7px 6px", fontSize: 13, borderBottom: "1px solid var(--border, #e2e8f0)" };

function Err({ msg }: { msg: string }) {
  if (!msg) return null;
  return <div style={{ color: "#b91c1c", padding: "6px 0", fontSize: 13, whiteSpace: "pre-wrap" }}>{msg}</div>;
}
function Ok({ msg }: { msg: string }) {
  if (!msg) return null;
  return <div style={{ color: "#15803d", padding: "6px 0", fontSize: 13, whiteSpace: "pre-wrap" }}>{msg}</div>;
}
async function call<T>(fn: () => Promise<T>): Promise<[T | null, string]> {
  try { return [await fn(), ""]; }
  catch (ex) { return [null, ex instanceof MesrjApiError ? ex.message : String(ex)]; }
}
/** 寿命进度条：使用率 ≥100% 红、≥预警线 黄 */
function LifeBar({ used, max, pct }: { used: number; max: number; pct: number }) {
  const color = pct >= 100 ? "#dc2626" : (pct >= 80 ? "#d97706" : "#16a34a");
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{ width: 76, height: 10, background: "#e2e8f0", borderRadius: 5, overflow: "hidden", display: "inline-block" }}>
        <span style={{ display: "block", height: "100%", width: `${Math.min(100, pct)}%`, background: color }} />
      </span>
      <span style={{ color, fontWeight: 600 }}>{`${used}/${max || 0}`}（{pct}%）</span>
    </span>
  );
}

// ── 类型 ────────────────────────────────────────────────────────────────────
interface PasteItem {
  id: number; batch_no: string; paste_type: string; material_code: string; product_name: string;
  supplier: string; arrive_date: string; expire_date: string; storage_temp: string;
  init_qty: number; left_qty: number; status: string; place: string; operator: string;
  remark: string; days_left: number | null; expire_flag: string; warn: boolean;
  warm_end?: string; warm_ok?: number; wait_used_h?: number; wait_left_h?: number; wait_over?: boolean;
}
interface StencilItem {
  id: number; stencil_no: string; sn: string; models: string; model: string; thickness: string;
  max_print_times: number; used_print_times: number; warn_pct: number; status: string;
  supplier: string; buy_date: string; price: number; place: string; owner: string;
  used: number; max: number; left: number | null; pct: number; state: string;
}
interface SqueegeeItem {
  id: number; sq_no: string; spec: string; material: string; model: string; position: string;
  max_times: number; used_times: number; warn_pct: number; status: string; supplier: string;
  price: number; place: string; owner: string; remark: string;
  used: number; max: number; left: number | null; pct: number; state: string;
  online_at: string; online_mo: string; online_time: string;
}
interface Overview {
  paste: { total: number; warn: number; expired: number; items: PasteItem[] };
  stencil: { total: number; warn: number; items: StencilItem[] };
  squeegee: { total: number; warn: number; items: SqueegeeItem[] };
}
interface MoRow { mo_no: string; product_code: string; product_model: string; line_code: string; plan_qty: number; out_qty: number; status: string; po_no: string; }

// ════════════════════════════════════════════════════════════════════════════
// 一、辅料管控（exec.smta）
// ════════════════════════════════════════════════════════════════════════════
export function SmtaView({ locale }: { locale: Locale }) {
  const [tab, setTab] = useState<"paste" | "stencil" | "squeegee" | "trace">("paste");
  const [ov, setOv] = useState<Overview | null>(null);
  const [pastes, setPastes] = useState<PasteItem[]>([]);
  const [stencils, setStencils] = useState<StencilItem[]>([]);
  const [squeegees, setSqueegees] = useState<SqueegeeItem[]>([]);
  const [kw, setKw] = useState("");
  const [ptype, setPtype] = useState("");
  const [onlyWarn, setOnlyWarn] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  const loadOv = useCallback(async () => {
    const [d, e] = await call(() => mesrjApi.get<Overview>("/smta/overview"));
    if (!e) setOv(d);
  }, []);

  const loadPaste = useCallback(async () => {
    const [d, e] = await call(() => mesrjApi.get<{ items: PasteItem[] }>("/smta/paste",
      { kw, ptype, only_warn: onlyWarn ? 1 : "" }));
    if (e || !d) { setErr(e || "未返回数据"); return; }
    setPastes(d.items); setErr("");
  }, [kw, ptype, onlyWarn]);

  const loadStencil = useCallback(async () => {
    const [d, e] = await call(() => mesrjApi.get<{ items: StencilItem[] }>("/smta/stencil", { kw }));
    if (e || !d) { setErr(e || "未返回数据"); return; }
    setStencils(d.items); setErr("");
  }, [kw]);

  const loadSqueegee = useCallback(async () => {
    const [d, e] = await call(() => mesrjApi.get<{ items: SqueegeeItem[] }>("/smta/squeegee"));
    if (e || !d) { setErr(e || "未返回数据"); return; }
    setSqueegees(d.items); setErr("");
  }, []);

  useEffect(() => { void loadOv(); }, [loadOv]);
  useEffect(() => { if (tab === "paste") void loadPaste(); }, [tab, loadPaste]);
  useEffect(() => { if (tab === "stencil") void loadStencil(); }, [tab, loadStencil]);
  useEffect(() => { if (tab === "squeegee") void loadSqueegee(); }, [tab, loadSqueegee]);

  const refreshAll = () => { void loadOv(); void loadPaste(); void loadStencil(); void loadSqueegee(); };

  const card = (title: string, o?: { total?: number; warn?: number }, extra = "") => {
    const bad = Number(o?.warn || 0);
    return (
      <div style={{ ...box, marginBottom: 0, flex: 1, minWidth: 180 }}>
        <div style={{ fontSize: 12, color: "#64748b" }}>{title}</div>
        <div style={{ fontSize: 26, fontWeight: 700, color: bad ? "#b91c1c" : "#0f172a" }}>{o?.total ?? 0}</div>
        <div style={{ fontSize: 12, color: bad ? "#b91c1c" : "#64748b" }}>
          {bad ? <b>{bad} {t("smta.warn", locale)}</b> : t("smta.all_normal", locale)}{extra}
        </div>
      </div>
    );
  };

  const tabBtn = (key: typeof tab, label: string) => (
    <button
      key={key}
      style={{ ...btn, marginRight: 0, borderRadius: tab === key ? "6px 0 0 6px" : 0,
        background: tab === key ? "#1d4ed8" : "#fff", color: tab === key ? "#fff" : "#475569" }}
      onClick={() => setTab(key)}>{label}</button>
  );

  // ── 锡膏动作：回温开始 / 回温结束 / 上线 / 下线 ──
  const pasteAction = async (p: PasteItem, act: "warm_start" | "warm_end" | "use" | "recover") => {
    setErr(""); setMsg("");
    const r = await call(() => mesrjMsg.post("/smta/paste/" + (act === "use" || act === "recover" ? "use" : "warm"),
      act === "warm_start" ? { batch_no: p.batch_no, start_time: new Date().toISOString().slice(0, 19).replace("T", " ") }
        : act === "warm_end" ? { batch_no: p.batch_no, end_time: new Date().toISOString().slice(0, 19).replace("T", " ") }
          : act === "use" ? { batch_no: p.batch_no, type: "USE" }
            : { batch_no: p.batch_no, type: "RECOVER", dispose: "回收" }));
    if (r[1]) { setErr(r[1]); return; }
    setMsg(r[0]?.msg || "");
    refreshAll();
  };

  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 10 }}>{t("menu.exec.smta", locale)}</div>
      <Ok msg={msg} /><Err msg={err} />

      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        {card(t("smta.tab.paste", locale), ov?.paste, ov?.paste.expired ? ` · ${ov.paste.expired} ${t("smta.expired", locale)}` : "")}
        {card(t("smta.tab.stencil", locale), ov?.stencil)}
        {card(t("smta.tab.squeegee", locale), ov?.squeegee)}
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
        <div style={{ display: "inline-flex" }}>
          {tabBtn("paste", t("smta.tab.paste", locale))}
          {tabBtn("stencil", t("smta.tab.stencil", locale))}
          {tabBtn("squeegee", t("smta.tab.squeegee", locale))}
          {tabBtn("trace", t("smta.tab.trace", locale))}
        </div>
        <span style={{ flex: 1 }} />
        {tab === "paste" && (
          <>
            <input {...inp} placeholder={t("smta.batch_no", locale)} value={kw}
              onChange={ev => setKw(ev.target.value)} />
            <select value={ptype} onChange={ev => setPtype(ev.target.value)} style={inp}>
              <option value="">{t("smta.paste_type", locale)}</option>
              <option value="红胶">红胶</option>
              <option value="锡膏">锡膏</option>
            </select>
            <label style={{ fontSize: 13 }}>
              <input type="checkbox" checked={onlyWarn} onChange={ev => setOnlyWarn(ev.target.checked)} />
              {t("smta.warn", locale)}
            </label>
            <button {...btnPrim} onClick={() => void loadPaste()}>{t("common.search", locale)}</button>
          </>
        )}
        {(tab === "stencil" || tab === "squeegee") && (
          <>
            <input {...inp} placeholder={t("smta.remark", locale)} value={kw}
              onChange={ev => setKw(ev.target.value)} />
            <button {...btnPrim} onClick={() => void (tab === "stencil" ? loadStencil() : loadSqueegee())}>
              {t("common.search", locale)}
            </button>
          </>
        )}
        <button {...btn} onClick={refreshAll}>{t("common.refresh", locale)}</button>
      </div>

      {tab === "paste" && (
        <div style={box}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>{t("smta.batch_no", locale)}</th>
                <th style={th}>{t("smta.paste_type", locale)}</th>
                <th style={th}>{t("smta.material_code", locale)}</th>
                <th style={th}>{t("smta.supplier", locale)}</th>
                <th style={th}>{t("smta.arrive_date", locale)}</th>
                <th style={th}>{t("smta.expire_date", locale)}</th>
                <th style={th}>{t("smta.days_left", locale)}</th>
                <th style={th}>{t("smta.status", locale)}</th>
                <th style={th}>{t("smta.left_qty", locale)}</th>
                <th style={th}>{t("smta.actions", locale)}</th>
              </tr>
            </thead>
            <tbody>
              {pastes.map(p => (
                <tr key={p.id} style={{ background: p.warn || p.wait_over ? "#fef2f2" : undefined }}>
                  <td style={td}>{p.batch_no}</td>
                  <td style={td}>{p.paste_type}</td>
                  <td style={td}>{p.material_code}</td>
                  <td style={td}>{p.supplier}</td>
                  <td style={td}>{p.arrive_date}</td>
                  <td style={td}>{p.expire_date}</td>
                  <td style={{ ...td, color: (p.days_left ?? 0) < 0 ? "#b91c1c" : (p.expire_flag === "临期" ? "#d97706" : undefined) }}>
                    {p.days_left ?? "—"}
                  </td>
                  <td style={td}>
                    {t(`status.${p.status}`, locale)}
                    {p.wait_over ? <span style={{ color: "#b91c1c" }}> ⚠</span> : null}
                  </td>
                  <td style={td}>{p.left_qty}</td>
                  <td style={td}>
                    {p.status === "回温中" ? (
                      <button {...btn} onClick={() => void pasteAction(p, "warm_end")}>{t("smta.warm_end", locale)}</button>
                    ) : (
                      <button {...btn} onClick={() => void pasteAction(p, "warm_start")}>{t("smta.warm_start", locale)}</button>
                    )}
                    {p.status === "待用" && <button {...btnPrim} onClick={() => void pasteAction(p, "use")}>{t("smta.paste_use", locale)}</button>}
                    {p.status === "使用中" && <button {...btnWarn} onClick={() => void pasteAction(p, "recover")}>{t("smta.paste_recover", locale)}</button>}
                  </td>
                </tr>
              ))}
              {!pastes.length && (
                <tr><td colSpan={10} style={{ ...td, color: "#64748b" }}>{t("common.noData", locale)}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === "stencil" && (
        <div style={box}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>{t("smta.stencil_no", locale)}</th>
                <th style={th}>{t("smta.models", locale)}</th>
                <th style={th}>{t("smta.model", locale)}</th>
                <th style={th}>{t("smta.thickness", locale)}</th>
                <th style={th}>{t("smta.pct", locale)}</th>
                <th style={th}>{t("smta.status", locale)}</th>
                <th style={th}>{t("smta.supplier", locale)}</th>
                <th style={th}>{t("smta.actions", locale)}</th>
              </tr>
            </thead>
            <tbody>
              {stencils.map(s => (
                <tr key={s.id} style={{ background: s.state === "已达寿命" ? "#fef2f2" : (s.state === "预警" ? "#fffbeb" : undefined) }}>
                  <td style={td}>{s.stencil_no}</td>
                  <td style={td}>{s.models}</td>
                  <td style={td}>{s.model}</td>
                  <td style={td}>{s.thickness}</td>
                  <td style={td}><LifeBar used={s.used} max={s.max} pct={s.pct} /></td>
                  <td style={td}>{t(`status.${s.state}`, locale)}</td>
                  <td style={td}>{s.supplier}</td>
                  <td style={td}>
                    <button {...btn} onClick={async () => {
                      const n = window.prompt(t("smta.print_times", locale), "1");
                      if (!n) return;
                      const r = await call(() => mesrjMsg.post("/smta/stencil/use", { stencil_no: s.stencil_no, times: Number(n) }));
                      if (r[1]) setErr(r[1]); else { setMsg(r[0]?.msg || ""); void loadStencil(); void loadOv(); }
                    }}>{t("smta.times", locale)}</button>
                  </td>
                </tr>
              ))}
              {!stencils.length && (
                <tr><td colSpan={8} style={{ ...td, color: "#64748b" }}>{t("common.noData", locale)}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === "squeegee" && (
        <div style={box}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>{t("smta.sq_no", locale)}</th>
                <th style={th}>{t("smta.spec", locale)}</th>
                <th style={th}>{t("smta.material", locale)}</th>
                <th style={th}>{t("smta.position", locale)}</th>
                <th style={th}>{t("smta.pct", locale)}</th>
                <th style={th}>{t("smta.status", locale)}</th>
                <th style={th}>{t("smta.online_at", locale)}</th>
                <th style={th}>{t("smta.actions", locale)}</th>
              </tr>
            </thead>
            <tbody>
              {squeegees.map(s => (
                <tr key={s.id} style={{ background: s.state === "已达寿命" ? "#fef2f2" : (s.state === "预警" ? "#fffbeb" : undefined) }}>
                  <td style={td}>{s.sq_no}</td>
                  <td style={td}>{s.spec}</td>
                  <td style={td}>{s.material}</td>
                  <td style={td}>{s.position}</td>
                  <td style={td}><LifeBar used={s.used} max={s.max} pct={s.pct} /></td>
                  <td style={td}>{t(`status.${s.status}`, locale)}</td>
                  <td style={td}>{s.online_at || "—"}</td>
                  <td style={td}>
                    {s.online_at ? (
                      <button {...btn} onClick={async () => {
                        const n = window.prompt(t("smta.times", locale), "0");
                        if (n === null) return;
                        const r = await call(() => mesrjMsg.post("/smta/squeegee/offline", { sq_no: s.sq_no, times: Number(n) }));
                        if (r[1]) setErr(r[1]); else { setMsg(r[0]?.msg || ""); void loadSqueegee(); void loadOv(); }
                      }}>{t("smta.offline", locale)}</button>
                    ) : (
                      <button {...btnPrim} onClick={async () => {
                        const machine = window.prompt(t("smta.machine_no", locale), "");
                        if (!machine) return;
                        const pos = window.prompt(t("smta.position", locale), "") || "";
                        const r = await call(() => mesrjMsg.post("/smta/squeegee/online", { sq_no: s.sq_no, machine_no: machine, position: pos }));
                        if (r[1]) setErr(r[1]); else { setMsg(r[0]?.msg || ""); void loadSqueegee(); void loadOv(); }
                      }}>{t("smta.online", locale)}</button>
                    )}
                    <button {...btn} onClick={async () => {
                      const n = window.prompt(t("smta.times", locale), "1");
                      if (!n) return;
                      const r = await call(() => mesrjMsg.post("/smta/squeegee/use", { sq_no: s.sq_no, times: Number(n) }));
                      if (r[1]) setErr(r[1]); else { setMsg(r[0]?.msg || ""); void loadSqueegee(); void loadOv(); }
                    }}>{t("smta.times", locale)}</button>
                  </td>
                </tr>
              ))}
              {!squeegees.length && (
                <tr><td colSpan={8} style={{ ...td, color: "#64748b" }}>{t("common.noData", locale)}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === "trace" && <SmtaTrace locale={locale} onMsg={setMsg} onErr={setErr} />}
    </div>
  );
}

// ── 按工单追溯 ──────────────────────────────────────────────────────────────
function SmtaTrace({ locale, onMsg, onErr }: {
  locale: Locale; onMsg: (s: string) => void; onErr: (s: string) => void;
}) {
  const [mos, setMos] = useState<MoRow[]>([]);
  const [mo, setMo] = useState("");
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void (async () => {
      const [d, e] = await call(() => mesrjApi.get<{ rows: MoRow[] }>("/smta/pda/mos", { scope: "all" }));
      if (e || !d) { onErr(e || "未返回数据"); return; }
      setMos(d.rows);
    })();
  }, [onErr]);

  const load = async () => {
    if (!mo) return;
    setLoading(true);
    const [d, e] = await call(() => mesrjApi.get<Record<string, unknown>>("/smta/trace/mo", { mo_no: mo }));
    setLoading(false);
    if (e || !d) { onErr(e || "未返回数据"); return; }
    setData(d); onErr("");
  };

  const summary = (data?.summary || {}) as Record<string, number>;
  const stencil = (data?.stencil || []) as Record<string, unknown>[];
  const squeegee = (data?.squeegee || []) as Record<string, unknown>[];
  const paste = (data?.paste || []) as Record<string, unknown>[];

  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
        <select value={mo} onChange={ev => setMo(ev.target.value)} style={{ ...inp, minWidth: 280 }}>
          <option value="">{t("smta.mo_no", locale)}</option>
          {mos.map(m => (
            <option key={m.mo_no} value={m.mo_no}>
              {`${m.mo_no} · ${m.product_code} ${m.product_model} · ${m.status}`}
            </option>
          ))}
        </select>
        <button {...btnPrim} disabled={loading || !mo} onClick={() => void load()}>{t("common.search", locale)}</button>
      </div>

      {data && (
        <>
          <div style={{ ...box, fontSize: 13 }}>
            {`${t("smta.model", locale)}: ${data.product_model || "—"} · ${t("smta.line_code", locale)}: ${data.line_code || "—"} · ${t("smta.status", locale)}: ${data.status || "—"} · ${data.plan_qty}/${data.out_qty}`}
            <div style={{ marginTop: 6, color: "#64748b" }}>
              {`钢网 ${summary.stencil_boards || 0} 次 / ${summary.stencil_times || 0} 次印刷 · 刮刀 ${summary.squeegee_uses || 0} 条 / ${summary.squeegee_times || 0} 次 · 锡膏 ${summary.paste_batches || 0} 批`}
            </div>
          </div>

          <div style={box}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>{t("smta.tab.stencil", locale)}</div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>
                <th style={th}>{t("smta.stencil_no", locale)}</th>
                <th style={th}>{t("smta.machine_no", locale)}</th>
                <th style={th}>{t("smta.model", locale)}</th>
                <th style={th}>{t("smta.times", locale)}</th>
                <th style={th}>{t("smta.online_time", locale) || ""}</th>
              </tr></thead>
              <tbody>
                {stencil.map((r, i) => (
                  <tr key={i}>
                    <td style={td}>{String(r.stencil_sn || "")}</td>
                    <td style={td}>{String(r.machine_no || "")}</td>
                    <td style={td}>{String(r.models || r.model || "")}</td>
                    <td style={td}>{String(r.used_in_round ?? "")}</td>
                    <td style={td}>{String(r.online_time || "")}</td>
                  </tr>
                ))}
                {!stencil.length && <tr><td colSpan={5} style={{ ...td, color: "#64748b" }}>{t("common.noData", locale)}</td></tr>}
              </tbody>
            </table>
          </div>

          <div style={box}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>{t("smta.tab.squeegee", locale)}</div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>
                <th style={th}>{t("smta.sq_no", locale)}</th>
                <th style={th}>{t("smta.machine_no", locale)}</th>
                <th style={th}>{t("smta.mo_no", locale)}</th>
                <th style={th}>{t("smta.times", locale)}</th>
                <th style={th}>{t("smta.use_date", locale) || ""}</th>
              </tr></thead>
              <tbody>
                {squeegee.map((r, i) => (
                  <tr key={i}>
                    <td style={td}>{String(r.sq_no || "")}</td>
                    <td style={td}>{String(r.machine_no || "")}</td>
                    <td style={td}>{String(r.mo_no || "")}</td>
                    <td style={td}>{String(r.times ?? "")}</td>
                    <td style={td}>{String(r.use_date || "")}</td>
                  </tr>
                ))}
                {!squeegee.length && <tr><td colSpan={5} style={{ ...td, color: "#64748b" }}>{t("common.noData", locale)}</td></tr>}
              </tbody>
            </table>
          </div>

          <div style={box}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>{t("smta.tab.paste", locale)}</div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>
                <th style={th}>{t("smta.batch_no", locale)}</th>
                <th style={th}>{t("smta.paste_type", locale)}</th>
                <th style={th}>{t("smta.mo_no", locale)}</th>
                <th style={th}>{t("smta.machine_no", locale)}</th>
                <th style={th}>{t("smta.operator", locale)}</th>
              </tr></thead>
              <tbody>
                {paste.map((r, i) => (
                  <tr key={i}>
                    <td style={td}>{String(r.batch_no || "")}</td>
                    <td style={td}>{String(r.paste_type || "")}</td>
                    <td style={td}>{String(r.mo_no || "")}</td>
                    <td style={td}>{String(r.machine_no || "")}</td>
                    <td style={td}>{String(r.operator || "")}</td>
                  </tr>
                ))}
                {!paste.length && <tr><td colSpan={5} style={{ ...td, color: "#64748b" }}>{t("common.noData", locale)}</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 二、SMT 站位绑码（cfg.feederslot）
// ════════════════════════════════════════════════════════════════════════════
interface SlotRow {
  id: number; model: string; machine_code: string; machine_no: string; slot_no: string;
  feeder_no: string; material_code: string; vn_code: string; spec: string; designators: string;
  remark: string; codes: string[]; alt_count: number;
}
const EMPTY_SLOT = {
  id: 0, model: "", machine_code: "", machine_no: "", slot_no: "", feeder_no: "",
  material_code: "", vn_code: "", spec: "", designators: "", remark: "",
};

export function FeederSlotView({ locale }: { locale: Locale }) {
  const [items, setItems] = useState<SlotRow[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [machines, setMachines] = useState<string[]>([]);
  const [model, setModel] = useState("");
  const [machine, setMachine] = useState("");
  const [kw, setKw] = useState("");
  const [form, setForm] = useState<typeof EMPTY_SLOT | null>(null);
  const [importText, setImportText] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [exportText, setExportText] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const [d, e] = await call(() => mesrjApi.get<{ items: SlotRow[]; models: string[]; machines: string[] }>(
      "/smta/slots", { model, machine_no: machine, kw }));
    if (e || !d) { setErr(e || "未返回数据"); return; }
    setItems(d.items); setModels(d.models); setMachines(d.machines); setErr("");
  }, [model, machine, kw]);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    if (!form) return;
    const [d, e] = await call(() => mesrjMsg.post<{ id: number; codes: string[] }>("/smta/slots", form));
    if (e || !d) { setErr(e || "未返回数据"); return; }
    setMsg(`${t("common.save", locale) || "已保存"}：${(d?.data?.codes || []).join(" / ")}`);
    setForm(null);
    void load();
  };

  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 10 }}>{t("menu.cfg.feederslot", locale)}</div>
      <Ok msg={msg} /><Err msg={err} />

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
        <select value={model} onChange={ev => setModel(ev.target.value)} style={inp}>
          <option value="">{t("smta.model", locale)}</option>
          {models.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <select value={machine} onChange={ev => setMachine(ev.target.value)} style={inp}>
          <option value="">{t("smta.machine_no", locale)}</option>
          {machines.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <input {...inp} placeholder={t("smta.material_code", locale)} value={kw}
          onChange={ev => setKw(ev.target.value)} />
        <button {...btnPrim} onClick={() => setForm({ ...EMPTY_SLOT })}>{t("common.new", locale)}</button>
        <button {...btn} onClick={() => setShowImport(!showImport)}>{t("smta.import", locale)}</button>
        <button {...btn} onClick={async () => {
          const [d, e] = await call(() => mesrjApi.get<{ text: string }>("/smta/slots/export", { model }));
          if (e || !d) { setErr(e || "未返回数据"); return; }
          setExportText(d.text);
        }}>{t("smta.export", locale)}</button>
        <button {...btn} onClick={() => void load()}>{t("common.refresh", locale)}</button>
      </div>

      {showImport && (
        <div style={box}>
          <div style={{ fontSize: 13, marginBottom: 6 }}>
            {`${t("smta.import", locale)} — ${t("smta.model", locale)} / ${t("smta.machine_code", locale)} / ${t("smta.machine_no", locale)} / ${t("smta.slot_no", locale)} / ${t("smta.feeder_no", locale)} / SZ / ${t("smta.vn_code", locale)} / ${t("smta.spec", locale)} / ${t("smta.designators", locale)}`}
          </div>
          <textarea
            value={importText}
            onChange={ev => setImportText(ev.target.value)}
            style={{ width: "100%", height: 140, fontFamily: "monospace", fontSize: 12, padding: 8 }}
            placeholder={"机型\t设备内部码\t机台编号\t站位编号\t飞达编号\tSZ料号RJ\tVN料号DT\t规格\t位号"}
          />
          <div style={{ marginTop: 8 }}>
            <button {...btnPrim} onClick={async () => {
              const [d, e] = await call(() => mesrjMsg.post<Record<string, unknown>>("/smta/slots/import",
                { text: importText, mode: "append", model }));
              if (e || !d) { setErr(e || "未返回数据"); return; }
              setMsg(d?.msg || "");
              setShowImport(false); setImportText("");
              void load();
            }}>{t("smta.import", locale)}</button>
          </div>
        </div>
      )}

      {exportText && (
        <div style={box}>
          <div style={{ fontSize: 13, marginBottom: 6 }}>{t("smta.export", locale)}</div>
          <textarea readOnly value={exportText} style={{ width: "100%", height: 140, fontFamily: "monospace", fontSize: 12, padding: 8 }} />
        </div>
      )}

      {form && (
        <div style={box}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>
            {form.id ? `${t("common.edit", locale)} #${form.id}` : t("common.new", locale)}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
            {([
              ["model", t("smta.model", locale)],
              ["machine_code", t("smta.machine_code", locale)],
              ["machine_no", t("smta.machine_no", locale)],
              ["slot_no", t("smta.slot_no", locale)],
              ["feeder_no", t("smta.feeder_no", locale)],
              ["material_code", t("smta.codes", locale)],
              ["vn_code", t("smta.vn_code", locale)],
              ["spec", t("smta.spec", locale)],
              ["designators", t("smta.designators", locale)],
            ] as [keyof typeof EMPTY_SLOT, string][]).map(([k, label]) => (
              <label key={k} style={{ fontSize: 12, color: "#64748b" }}>
                {label}
                <input
                  style={{ width: "100%", height: 32, padding: "0 8px", border: "1px solid #cbd5e1", borderRadius: 5, fontSize: 13 }}
                  value={String(form[k] ?? "")}
                  onChange={ev => setForm({ ...form, [k]: ev.target.value })}
                />
              </label>
            ))}
          </div>
          <div style={{ marginTop: 10 }}>
            <button {...btnPrim} onClick={() => void save()}>{t("common.save", locale)}</button>
            <button {...btn} onClick={() => setForm(null)}>{t("common.cancel", locale)}</button>
          </div>
        </div>
      )}

      <div style={box}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>
            <th style={th}>{t("smta.model", locale)}</th>
            <th style={th}>{t("smta.machine_code", locale)}</th>
            <th style={th}>{t("smta.machine_no", locale)}</th>
            <th style={th}>{t("smta.slot_no", locale)}</th>
            <th style={th}>{t("smta.feeder_no", locale)}</th>
            <th style={th}>{t("smta.codes", locale)}</th>
            <th style={th}>{t("smta.vn_code", locale)}</th>
            <th style={th}>{t("smta.spec", locale)}</th>
            <th style={th}>{t("smta.designators", locale)}</th>
            <th style={th} />
          </tr></thead>
          <tbody>
            {items.map(r => (
              <tr key={r.id}>
                <td style={td}>{r.model}</td>
                <td style={td}>{r.machine_code}</td>
                <td style={td}>{r.machine_no}</td>
                <td style={td}>{r.slot_no}</td>
                <td style={td}>{r.feeder_no}</td>
                <td style={td}>
                  {(r.codes || []).join(" / ")}
                  {r.alt_count > 0 && <span style={{ color: "#d97706" }}> (+{r.alt_count})</span>}
                </td>
                <td style={td}>{r.vn_code}</td>
                <td style={td}>{r.spec}</td>
                <td style={td}>{r.designators}</td>
                <td style={td}>
                  <button {...btn} onClick={() => setForm({
                    id: r.id, model: r.model, machine_code: r.machine_code, machine_no: r.machine_no,
                    slot_no: r.slot_no, feeder_no: r.feeder_no, material_code: r.material_code,
                    vn_code: r.vn_code, spec: r.spec, designators: r.designators, remark: r.remark,
                  })}>{t("common.edit", locale)}</button>
                  <button {...btn} onClick={async () => {
                    if (!window.confirm(t("common.deleteConfirm", locale))) return;
                    const [d, e] = await call(() => mesrjMsg.del(`/smta/slots/${r.id}`));
                    if (e || !d) { setErr(e || "未返回数据"); return; }
                    setMsg(d?.msg || "");
                    void load();
                  }}>{t("common.delete", locale)}</button>
                </td>
              </tr>
            ))}
            {!items.length && <tr><td colSpan={10} style={{ ...td, color: "#64748b" }}>{t("common.noData", locale)}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 三、辅料时间参数（cfg.times）
// ════════════════════════════════════════════════════════════════════════════
interface Threshold { id: number; th_key: string; th_name: string; th_value: number; th_unit: string; enabled: number; remark: string; }
interface PasteParam {
  id: number; paste_type: string; storage_min: number; storage_max: number; warm_hours: number;
  wait_hours: number; open_hours: number; valid_months: number; warn_days: number;
}

export function TimesView({ locale }: { locale: Locale }) {
  const [ths, setThs] = useState<Threshold[]>([]);
  const [pas, setPas] = useState<PasteParam[]>([]);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const [d, e] = await call(() => mesrjApi.get<{ thresholds: Threshold[]; paste: PasteParam[] }>("/smta/times"));
    if (e || !d) { setErr(e || "未返回数据"); return; }
    setThs(d.thresholds); setPas(d.paste); setErr("");
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    const [d, e] = await call(() => mesrjMsg.post<{ thresholds: number; paste: number }>("/smta/times",
      { thresholds: ths.map(x => ({ th_key: x.th_key, th_value: x.th_value })), paste: pas }));
    if (e || !d) { setErr(e || "未返回数据"); return; }
    setMsg(d?.msg || "");
    void load();
  };

  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 10 }}>{t("menu.cfg.times", locale)}</div>
      <Ok msg={msg} /><Err msg={err} />

      <div style={{ ...box, marginBottom: 14 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>{t("smta.thresholds", locale)}</div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>
            <th style={th}>Key</th>
            <th style={th}>{t("smta.remark", locale)}</th>
            <th style={th}>{t("smta.times", locale)}</th>
            <th style={th}>Unit</th>
            <th style={th}>Enabled</th>
          </tr></thead>
          <tbody>
            {ths.map((x, i) => (
              <tr key={x.id}>
                <td style={td}>{x.th_key}</td>
                <td style={td}>{x.th_name}</td>
                <td style={td}>
                  <input
                    style={{ width: 90, padding: "3px 6px", border: "1px solid #cbd5e1", borderRadius: 5 }}
                    type="number" step="0.01" value={x.th_value}
                    onChange={ev => {
                      const next = [...ths];
                      next[i] = { ...x, th_value: Number(ev.target.value) };
                      setThs(next);
                    }}
                  />
                </td>
                <td style={td}>{x.th_unit}</td>
                <td style={td}>{x.enabled ? "✓" : "—"}</td>
              </tr>
            ))}
            {!ths.length && <tr><td colSpan={5} style={{ ...td, color: "#64748b" }}>{t("common.noData", locale)}</td></tr>}
          </tbody>
        </table>
      </div>

      <div style={box}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>{t("smta.tab.paste", locale)}</div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>
            <th style={th}>{t("smta.paste_type", locale)}</th>
            <th style={th}>{t("smta.storage_min", locale)}</th>
            <th style={th}>{t("smta.storage_max", locale)}</th>
            <th style={th}>{t("smta.warm_hours", locale)}</th>
            <th style={th}>{t("smta.wait_hours", locale)}</th>
            <th style={th}>{t("smta.open_hours", locale)}</th>
            <th style={th}>{t("smta.valid_months", locale)}</th>
            <th style={th}>{t("smta.warn_days", locale)}</th>
          </tr></thead>
          <tbody>
            {pas.map((x, i) => (
              <tr key={x.id}>
                <td style={td}>{x.paste_type}</td>
                {([
                  "storage_min", "storage_max", "warm_hours", "wait_hours",
                  "open_hours", "valid_months", "warn_days",
                ] as (keyof PasteParam)[]).map(k => (
                  <td key={k} style={td}>
                    <input
                      style={{ width: 76, padding: "3px 6px", border: "1px solid #cbd5e1", borderRadius: 5 }}
                      type="number" step="0.1" value={String(x[k])}
                      onChange={ev => {
                        const next = [...pas];
                        next[i] = { ...x, [k]: Number(ev.target.value) };
                        setPas(next);
                      }}
                    />
                  </td>
                ))}
              </tr>
            ))}
            {!pas.length && <tr><td colSpan={8} style={{ ...td, color: "#64748b" }}>{t("common.noData", locale)}</td></tr>}
          </tbody>
        </table>
      </div>

      <button {...btnPrim} onClick={() => void save()}>{t("common.save", locale)}</button>
    </div>
  );
}
