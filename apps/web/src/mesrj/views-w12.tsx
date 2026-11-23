// MES-ruijing W12 前端 —— 分板/拼版 · 栈板 · 维修交接/解报废 · 分析/大屏/追溯导出
// 后端路由（services/api/src/routes/mesrj.js，源 panel.py(10) + pallet.py(14) + repair.py(31)
//   + analyze.py(10) + board.py(2) + trace_export.py(5) = 72 路由）：
//   GET  /panel/sn/parse           SN 分段解析
//   GET  /panel/layout/list        拼版布局列表
//   POST /panel/layout/save        布局保存
//   POST /panel/layout/delete      布局删除
//   GET  /panel/view               拼版视图（按 SN / 布局）
//   POST /panel/judge              逐格判定
//   GET  /panel/next               下一站
//   POST /panel/align              对齐布局
//   GET  /panel/aging              拼版老化
//   GET  /panel/layout/match       按产品/机型匹配布局
//   GET  /pallet/init              栈板初始化信息
//   POST /pallet/open              开板（取或新建装板中栈板）
//   POST /pallet/box/add           外箱装板
//   POST /pallet/box/remove        外箱移出
//   POST /pallet/close             封板（生成正式栈板码 + 打印）
//   GET  /pallet/list              栈板列表
//   GET  /pallet/detail            栈板详情（含箱）
//   POST /pallet/reopen            重开栈板
//   POST /pallet/change-po         改挂 PO
//   POST /pallet/reprint           补打栈板标签
//   GET  /pallet/next              下一张栈板码预览
//   GET  /pallet/po-log            改挂 PO 台账
//   GET  /repair/pending           待修清单
//   GET  /repair/handover          交接单列表
//   POST /repair/handover          开交接单
//   GET  /repair/handover/:no      交接单明细
//   POST /repair/handover/:no/accept  接收交接单
//   POST /repair/handover/:no/item    登记维修结果
//   POST /repair/handover/:no/close   关闭交接单
//   POST /repair/handover/:no/return  整单退回
//   GET  /repair/summary           维修汇总
//   GET  /repair/pending-summary   待交接看板
//   POST /repair/auto-gen          自动生成交接单
//   GET  /repair/scrap/release/list    解报废列表
//   POST /repair/scrap/release/apply   申请解报废
//   POST /repair/scrap/release/approve 批准/驳回
//   GET  /repair/scrap/release/check   查解报废状态
//   POST /repair/photo             上传维修照片
//   GET  /repair/photo             获取维修照片
//   GET  /repair/dispositions      处置字典
//   GET  /repair/phenomena         不良现象字典
//   GET  /repair/sn/context        扫码上下文
//   GET  /repair/designator        按位号反查料号
//   GET  /repair/material_batch    料号批次/D/C
//   GET  /repair/detail            维修明细列表
//   POST /repair/detail            新建维修单
//   GET  /repair/detail/:no        维修单详情
//   POST /repair/detail/:no/part   加换料记录
//   POST /repair/detail/:no/verify 人工复核
//   POST /repair/detail/:no/scrap-verify 品质判废/驳回
//   POST /repair/detail/:no/to-manual    转人工判定
//   POST /repair/detail/:no/photo  挂照片
//   GET  /repair/stats             维修统计
//   GET  /report/oee               OEE
//   GET  /report/spc/params        SPC 参数
//   GET  /report/spc               SPC 数据
//   GET  /alert/rules              预警规则
//   POST /alert/rules              保存预警规则
//   GET  /alert/list               预警列表
//   POST /alert/handle             处置预警
//   GET  /alert/active             活跃预警
//   GET  /alert/check              预警检查
//   GET  /report/output            产能看板
//   GET  /board/shopfloor          车间大屏
//   GET  /trace/po/summary         PO 追溯汇总
//   GET  /trace/po/export          PO 追溯导出 Excel
//   GET  /trace/sn/summary         SN 追溯汇总
//   GET  /trace/sn/query           任意码查询
//   POST /trace/po/clean           PO 追溯清理
import { useCallback, useEffect, useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { mesrjApi, mesrjMsg, MesrjApiError } from "./api";
import { t } from "./i18n";

const box = { border: "1px solid var(--border, #e2e8f0)", borderRadius: 10, padding: 14, marginBottom: 14 } as const;
const inp = { padding: "6px 8px", marginRight: 6, border: "1px solid var(--border, #e2e8f0)", borderRadius: 6 } as const;
const btn = { padding: "6px 12px", marginRight: 6, borderRadius: 6, border: "1px solid var(--border, #e2e8f0)", background: "#fff", cursor: "pointer" } as const;
const btnPrim = { ...btn, background: "#2563eb", color: "#fff", borderColor: "#2563eb" } as const;
const btnWarn = { ...btn, background: "#b45309", color: "#fff", borderColor: "#b45309" } as const;
const btnDanger = { ...btn, background: "#dc2626", color: "#fff", borderColor: "#dc2626" } as const;
const th = { padding: "8px 6px", textAlign: "left" as const, borderBottom: "2px solid var(--border, #e2e8f0)", fontSize: 13 };
const td = { padding: "7px 6px", fontSize: 13, borderBottom: "1px solid var(--border, #e2e8f0)" };
const tdMuted = { ...td, color: "#64748b" };

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

interface MoOpt { mo_no: string; product_code?: string; status?: string; line_code?: string; plan_qty?: number; done_qty?: number; }
type Dict = { v: string; t: string };

// ════════════════════════════════════════════════════════════════════════════
// 1. 分板扫码（exec.panelsplit）—— 源 panel.py 前端
// ════════════════════════════════════════════════════════════════════════════
interface PanelSlot { sn: string; panel_pos: string; row: number; col: number; }
interface PanelBase { sn: string; product_code?: string; mo_no?: string; status?: string; cur_station?: string; }
interface PanelLayout {
  id: number; model?: string; product_code?: string; cols: number; rows: number;
  total?: number; serpentine?: number; seq_offset?: number; enabled?: number; remark?: string;
}
interface PanelView { base: PanelBase | null; layout: PanelLayout | null; slots: PanelSlot[]; aoi: Array<Record<string, unknown>> | null; }
interface AgingInfo { hours: number; first_time?: string | null; }
interface RouteStep { station_code?: string; station_name?: string; process_code?: string; seq_no?: number; }

export function PanelSplitView({ locale }: { locale: Locale }) {
  const [mo, setMo] = useState("");
  const [mos, setMos] = useState<MoOpt[]>([]);
  const [sn, setSn] = useState("");
  const [station, setStation] = useState("");
  const [view, setView] = useState<PanelView | null>(null);
  const [aging, setAging] = useState<AgingInfo | null>(null);
  const [next, setNext] = useState<RouteStep | null>(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const loadMos = useCallback(async () => {
    const [d, e] = await call(() => mesrjApi.get<{ rows: MoOpt[] }>("/order/mo/options"));
    if (e || !d) return;
    setMos(d.rows || []);
  }, []);
  useEffect(() => { void loadMos(); }, [loadMos]);

  const loadView = useCallback(async () => {
    const code = sn.trim();
    if (!code) { setView(null); setAging(null); setNext(null); return; }
    setErr(""); setMsg("");
    const [v, e] = await call(() => mesrjApi.get<PanelView>("/panel/view", { sn: code }));
    if (e || !v) { setErr(e || "未返回数据"); setView(null); return; }
    setView(v);
    const moNo = (v.base?.mo_no || mo || "").trim();
    if (v.base?.mo_no) setMo(v.base.mo_no);
    if (moNo) {
      const [n] = await call(() => mesrjApi.get<RouteStep | null>(
        "/panel/next", { mo_no: moNo, cur_station: station }));
      setNext(n || null);
    } else setNext(null);
  }, [sn, mo, station]);

  const loadAging = async () => {
    const code = sn.trim();
    if (!code) return;
    const [a, e] = await call(() => mesrjApi.get<AgingInfo>("/panel/aging", { sn: code }));
    if (e) setErr(e); else setAging(a);
  };

  const judge = async () => {
    const moNo = (view?.base?.mo_no || mo).trim();
    if (!moNo || !station.trim()) { setErr(t("w12.panel.mo_station_required", locale)); return; }
    setBusy(true); setErr(""); setMsg("");
    const [d, e] = await call(() => mesrjMsg.post("/panel/judge", {
      mo_no: moNo, station_code: station.trim(),
    }));
    setBusy(false);
    if (e) { setErr(e); return; }
    setMsg(d?.msg || t("w12.panel.judged", locale));
  };

  const align = async () => {
    const code = sn.trim();
    if (!code) return;
    setBusy(true); setErr(""); setMsg("");
    const [d, e] = await call(() => mesrjMsg.post<{ layout: PanelLayout | null }>("/panel/align", { sn: code }));
    setBusy(false);
    if (e) { setErr(e); return; }
    if (!d?.data?.layout) { setErr(t("w12.panel.no_layout", locale)); return; }
    setMsg(d?.msg || t("w12.panel.aligned", locale));
    void loadView();
  };

  const aoiMap = new Map<string, Record<string, unknown>>();
  for (const a of view?.aoi || []) {
    const k = String(a.pcb_sn || "");
    if (k) aoiMap.set(k, a);
  }
  const resultOf = (code: string) => {
    const a = aoiMap.get(code);
    if (!a) return "";
    return String(a.final_result || a.user_result || a.robot_result || "");
  };

  const parseSn = async () => {
    const code = sn.trim();
    if (!code) return;
    const [d, e] = await call(() => mesrjApi.get<{ prefix?: string; num?: number; suffix?: string; width?: number; error?: string }>(
      "/panel/sn/parse", { sn: code }));
    if (e) { setErr(e); return; }
    setMsg(d?.error ? d.error : `${t("w12.panel.prefix", locale)} ${d?.prefix} · ${t("w12.panel.num", locale)} ${d?.num} · ${t("w12.panel.suffix", locale)} ${d?.suffix} · ${t("w12.panel.width", locale)} ${d?.width}`);
  };

  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 10 }}>{t("menu.exec.panelsplit", locale)}</div>
      <Ok msg={msg} /><Err msg={err} />

      <div style={{ ...box, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <select value={mo} onChange={ev => setMo(ev.target.value)} style={{ ...inp, minWidth: 280 }}>
          <option value="">{t("w12.common.mo_no", locale)}</option>
          {mos.map(m => <option key={m.mo_no} value={m.mo_no}>{`${m.mo_no} · ${m.product_code} · ${m.status}`}</option>)}
        </select>
        <input style={{ ...inp, width: 240 }} placeholder={t("w12.panel.sn_ph", locale)}
          value={sn} onChange={ev => setSn(ev.target.value)}
          onKeyDown={ev => { if (ev.key === "Enter") void loadView(); }} />
        <input style={{ ...inp, width: 160 }} placeholder={t("w12.panel.station_ph", locale)}
          value={station} onChange={ev => setStation(ev.target.value)} />
        <button {...btnPrim} disabled={busy || !sn.trim()} onClick={() => void loadView()}>
          {t("w12.panel.load", locale)}
        </button>
        <button {...btn} disabled={busy || !sn.trim()} onClick={() => void parseSn()}>
          {t("w12.panel.parse", locale)}
        </button>
        <button {...btn} disabled={busy || !sn.trim()} onClick={() => void loadAging()}>
          {t("w12.panel.aging", locale)}
        </button>
        <button {...btn} disabled={busy || !sn.trim()} onClick={() => void align()}>
          {t("w12.panel.align", locale)}
        </button>
      </div>

      {next && (
        <div style={{ ...box, fontSize: 13 }}>
          <span>{t("w12.panel.next_station", locale)}: <b>{`${next.station_code || "—"}${next.station_name ? ` ${next.station_name}` : ""}`}</b></span>
          {next.process_code ? <span style={{ marginLeft: 16, color: "#64748b" }}>
            {t("w12.panel.route", locale)}: {next.process_code}
          </span> : null}
        </div>
      )}

      {aging && (
        <div style={{ ...box, fontSize: 13, display: "flex", gap: 18, flexWrap: "wrap" }}>
          <span>{t("w12.panel.smt_at", locale)}: <b>{aging.first_time ? String(aging.first_time).slice(0, 16).replace("T", " ") : "—"}</b></span>
          <span style={{ color: aging.hours >= 24 ? "#dc2626" : "#15803d" }}>
            {t("w12.panel.age_h", locale)}: <b>{aging.hours ?? "—"}</b>
            {aging.hours >= 24 ? `（${t("w12.panel.expired", locale)}）` : ""}
          </span>
        </div>
      )}

      {view && (
        <div style={box}>
          <div style={{ fontSize: 13, marginBottom: 8 }}>
            {`${t("w12.panel.panel_sn", locale)}: ${view.base?.sn || sn}` +
              ` · ${t("w12.common.mo_no", locale)}: ${view.base?.mo_no || mo || "—"}` +
              (view.layout ? ` · ${view.layout.model || view.layout.product_code || ""} ${view.layout.cols}×${view.layout.rows}` +
                ` · ${t("w12.panel.total", locale)}: ${view.layout.total ?? view.layout.cols * view.layout.rows}` +
                (view.layout.serpentine ? ` · ${t("w12.panel.serpentine", locale)}` : "") : "")}
          </div>
          {!view.layout && (
            <div style={{ fontSize: 13, color: "#b45309", marginBottom: 8 }}>{t("w12.panel.no_layout", locale)}</div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.max(view.layout?.cols || 1, 1)}, minmax(72px, 1fr))`, gap: 4 }}>
            {[...(view.slots || [])].sort((a, b) => (a.row - b.row) || (a.col - b.col)).map(sl => {
              const result = resultOf(sl.sn);
              const color = /NG|FAIL/i.test(result) ? "#dc2626" : /OK|PASS/i.test(result) ? "#16a34a" : "#94a3b8";
              return (
                <div key={sl.panel_pos || sl.sn} title={`${sl.sn || "—"} ${result || "—"}`}
                  style={{ border: `2px solid ${color}`, borderRadius: 6, padding: 4, fontSize: 10, minHeight: 46, background: "#fff" }}>
                  <div style={{ fontWeight: 700, color }}>{sl.panel_pos}</div>
                  <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sl.sn || "—"}</div>
                  <div style={{ color }}>{result || "—"}</div>
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 10 }}>
            <button {...btnPrim} disabled={busy} onClick={() => void judge()}>
              {t("w12.panel.judge", locale)}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 2. 拼版布局（cfg.panellayout）—— 布局 CRUD + 匹配预览
// ════════════════════════════════════════════════════════════════════════════
interface LayoutRow { id: number; model?: string; product_code?: string; cols: number; rows: number; total?: number; serpentine?: number; seq_offset?: number; enabled?: number; remark?: string; }

export function PanelLayoutView({ locale }: { locale: Locale }) {
  const [rows, setRows] = useState<LayoutRow[]>([]);
  const [editing, setEditing] = useState<LayoutRow | "new" | null>(null);
  const [form, setForm] = useState({ product_code: "", model: "", cols: "1", rows: "1", serpentine: "1", seq_offset: "0", remark: "" });
  const [matchPC, setMatchPC] = useState("");
  const [matched, setMatched] = useState<LayoutRow | null>(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [d, e] = await call(() => mesrjApi.get<LayoutRow[]>("/panel/layout/list"));
    if (e || !d) { setErr(e || "未返回数据"); return; }
    setRows(d || []);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const openNew = () => {
    setForm({ product_code: "", model: "", cols: "1", rows: "1", serpentine: "1", seq_offset: "0", remark: "" });
    setEditing("new");
  };
  const openEdit = (r: LayoutRow) => {
    setForm({
      product_code: r.product_code || "", model: r.model || "",
      cols: String(r.cols ?? 1), rows: String(r.rows ?? 1), serpentine: String(r.serpentine ?? 1),
      seq_offset: String(r.seq_offset ?? 0), remark: r.remark || "",
    });
    setEditing(r);
  };
  const save = async () => {
    if (!editing) return;
    if (!form.model.trim()) { setErr(t("w12.layout.model_required", locale)); return; }
    setBusy(true); setErr(""); setMsg("");
    const body = {
      ...(editing !== "new" ? { id: editing.id } : {}),
      product_code: form.product_code, model: form.model,
      cols: Number(form.cols) || 1, rows: Number(form.rows) || 1,
      serpentine: Number(form.serpentine) ? 1 : 0, seq_offset: Number(form.seq_offset) || 0,
      enabled: true, remark: form.remark,
    };
    const [d, e] = await call(() => mesrjMsg.post("/panel/layout/save", body));
    setBusy(false);
    if (e) { setErr(e); return; }
    setMsg(d?.msg || t("w12.common.saved", locale));
    setEditing(null);
    void load();
  };
  const remove = async (r: LayoutRow) => {
    if (!window.confirm(t("common.deleteConfirm", locale))) return;
    setBusy(true); setErr("");
    const [d, e] = await call(() => mesrjMsg.post("/panel/layout/delete", { id: r.id }));
    setBusy(false);
    if (e) { setErr(e); return; }
    setMsg(d?.msg || t("w12.common.deleted", locale));
    void load();
  };
  const match = async () => {
    if (!matchPC.trim()) return;
    const [d, e] = await call(() => mesrjApi.get<{ layout: LayoutRow | null }>("/panel/layout/match", { product_code: matchPC.trim() }));
    if (e) { setErr(e); return; }
    setMatched(d?.layout || null);
  };

  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 10 }}>{t("menu.cfg.panellayout", locale)}</div>
      <Ok msg={msg} /><Err msg={err} />

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <input style={{ ...inp, width: 200 }} placeholder={t("w12.layout.match_ph", locale)}
          value={matchPC} onChange={ev => setMatchPC(ev.target.value)} />
        <button {...btn} onClick={() => void match()}>{t("w12.layout.match", locale)}</button>
        {matched && <span style={{ fontSize: 13, color: "#15803d" }}>
          {`${matched.model || matched.product_code || matched.id} · ${matched.cols}×${matched.rows}`}
        </span>}
        <button {...btnPrim} style={{ marginLeft: "auto" }} onClick={openNew}>{t("common.new", locale)}</button>
        <button {...btn} onClick={() => void load()}>{t("common.refresh", locale)}</button>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr>
            <th style={th}>{t("w12.layout.model", locale)}</th>
            <th style={th}>{t("w12.layout.product", locale)}</th>
            <th style={th}>{t("w12.layout.cols", locale)}</th>
            <th style={th}>{t("w12.layout.rows", locale)}</th>
            <th style={th}>{t("w12.layout.total", locale)}</th>
            <th style={th}>{t("w12.layout.serpentine", locale)}</th>
            <th style={th}>{t("w12.layout.seq_offset", locale)}</th>
            <th style={th}>{t("w12.layout.remark", locale)}</th>
            <th style={th}>{t("common.actions", locale)}</th>
          </tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}>
                <td style={{ ...td, fontWeight: 600 }}>{r.model || "—"}</td>
                <td style={td}>{r.product_code || "—"}</td>
                <td style={td}>{r.cols}</td>
                <td style={td}>{r.rows}</td>
                <td style={td}>{r.total ?? (r.cols * r.rows)}</td>
                <td style={td}>{r.serpentine ? t("common.yes", locale) : t("common.no", locale)}</td>
                <td style={td}>{r.seq_offset ?? 0}</td>
                <td style={tdMuted}>{r.remark || "—"}</td>
                <td style={td}>
                  <button {...btn} onClick={() => openEdit(r)}>{t("common.edit", locale)}</button>
                  <button {...btnDanger} onClick={() => void remove(r)}>{t("common.delete", locale)}</button>
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={9} style={{ ...tdMuted, padding: 12 }}>{t("common.noData", locale)}</td></tr>}
          </tbody>
        </table>
      </div>

      {editing && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60 }}>
          <div style={{ background: "var(--surface, #fff)", borderRadius: 10, padding: 18, minWidth: 440, maxHeight: "80vh", overflowY: "auto" }}>
            <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>
              {editing === "new" ? t("common.new", locale) : t("common.edit", locale)}
            </h3>
            <label style={{ display: "block", marginBottom: 10, fontSize: 13 }}>
              <span>{t("w12.layout.model", locale)}</span>
              <input style={{ width: "100%", padding: "6px 8px", marginTop: 4, boxSizing: "border-box", background: editing === "new" ? "#fff" : "#f1f5f9" }}
                disabled={editing !== "new"}
                title={editing !== "new" ? t("w12.layout.model_locked", locale) : ""}
                value={form.model} onChange={ev => setForm(s => ({ ...s, model: ev.target.value }))} />
            </label>
            {([
              ["product_code", t("w12.layout.product", locale)],
              ["cols", t("w12.layout.cols", locale)],
              ["rows", t("w12.layout.rows", locale)],
              ["seq_offset", t("w12.layout.seq_offset", locale)],
            ] as Array<[keyof typeof form, string]>).map(([key, label]) => (
              <label key={key} style={{ display: "block", marginBottom: 10, fontSize: 13 }}>
                <span>{label}</span>
                <input style={{ width: "100%", padding: "6px 8px", marginTop: 4, boxSizing: "border-box" }}
                  type={["cols", "rows", "seq_offset"].includes(key) ? "number" : "text"}
                  value={form[key]} onChange={ev => setForm(s => ({ ...s, [key]: ev.target.value }))} />
              </label>
            ))}
            <label style={{ display: "block", marginBottom: 10, fontSize: 13 }}>
              <span>{t("w12.layout.serpentine", locale)}</span>
              <select style={{ width: "100%", padding: "6px 8px", marginTop: 4 }}
                value={form.serpentine} onChange={ev => setForm(s => ({ ...s, serpentine: ev.target.value }))}>
                <option value="1">{t("common.yes", locale)}</option>
                <option value="0">{t("common.no", locale)}</option>
              </select>
            </label>
            <label style={{ display: "block", marginBottom: 10, fontSize: 13 }}>
              <span>{t("w12.layout.remark", locale)}</span>
              <input style={{ width: "100%", padding: "6px 8px", marginTop: 4, boxSizing: "border-box" }}
                value={form.remark} onChange={ev => setForm(s => ({ ...s, remark: ev.target.value }))} />
            </label>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
              <button {...btn} onClick={() => setEditing(null)}>{t("common.cancel", locale)}</button>
              <button {...btnPrim} disabled={busy} onClick={() => void save()}>{t("common.save", locale)}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 3. 栈板绑码（exec.pallet）—— 源 pallet.py 前端
// ════════════════════════════════════════════════════════════════════════════
interface PalletInit {
  mo_no: string; product_code: string; cust_code: string; plan_qty: number; out_qty: number;
  line_code: string; carton_qty: number; cartons_per_pallet: number; pallet_tpl_code: string;
  open_pallet: { pallet_no: string; status: string; box_count: number; total_qty: number } | null;
  templates: Array<{ tpl_code: string; tpl_name: string; file_name: string }>;
}
interface PalletRow {
  id?: number; pallet_no: string; mo_no: string; po_no: string; product_code: string;
  capacity: number; box_count: number; total_qty: number; status: string; line_code: string;
  tpl_code?: string; print_times?: number; created_by?: string; created_at?: string;
  boxes?: Array<{ box_no: string; qty: number; status: string }>;
}
interface PoLogRow { id: number; pallet_no: string; mo_no: string; from_po: string; to_po: string; qty: number; box_count: number; reason: string; operator: string; created_at: string; }

export function PalletView({ locale }: { locale: Locale }) {
  const [mos, setMos] = useState<MoOpt[]>([]);
  const [mo, setMo] = useState("");
  const [line, setLine] = useState("");
  const [po, setPo] = useState("");
  const [init, setInit] = useState<PalletInit | null>(null);
  const [open, setOpen] = useState<PalletRow | null>(null);
  const [list, setList] = useState<PalletRow[]>([]);
  const [poLog, setPoLog] = useState<PoLogRow[]>([]);
  const [boxNo, setBoxNo] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const loadMos = useCallback(async () => {
    const [d, e] = await call(() => mesrjApi.get<{ rows: MoOpt[] }>("/order/mo/options"));
    if (e || !d) return;
    setMos(d.rows || []);
  }, []);
  useEffect(() => { void loadMos(); }, [loadMos]);

  const loadInit = useCallback(async () => {
    if (!mo) { setInit(null); setOpen(null); return; }
    const [d, e] = await call(() => mesrjApi.get<PalletInit>("/pallet/init", { mo_no: mo }));
    if (e || !d) { setErr(e || "未返回数据"); return; }
    setInit(d);
    setLine(d.line_code || line);
    if (d.open_pallet) {
      const [od] = await call(() => mesrjApi.get<PalletRow>("/pallet/detail", { pallet_no: d.open_pallet?.pallet_no || "" }));
      setOpen(od);
    } else setOpen(null);
  }, [mo, line]);
  useEffect(() => { void loadInit(); }, [loadInit]);

  const loadList = useCallback(async () => {
    const [d, e] = await call(() => mesrjApi.get<{ list: PalletRow[]; total: number }>("/pallet/list",
      { mo_no: mo, pageSize: 50 }));
    if (e || !d) return;
    setList(d.list || []);
  }, [mo]);
  useEffect(() => { void loadList(); }, [loadList]);

  const loadPoLog = useCallback(async () => {
    const [d, e] = await call(() => mesrjApi.get<PoLogRow[]>("/pallet/po-log", {}));
    if (e || !d) return;
    setPoLog(d || []);
  }, []);
  useEffect(() => { void loadPoLog(); }, [loadPoLog]);

  const act = async (path: string, body: Record<string, unknown>, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true); setErr(""); setMsg("");
    const [d, e] = await call(() => mesrjMsg.post(path, body));
    setBusy(false);
    if (e) { setErr(e); return null; }
    setMsg(d?.msg || t("w12.common.saved", locale));
    void loadInit(); void loadList(); void loadPoLog();
    return d?.data ?? null;
  };

  const openPallet = async () => {
    if (!mo) { setErr(t("w12.pallet.mo_required", locale)); return; }
    setBusy(true); setErr(""); setMsg("");
    const [d, e] = await call(() => mesrjMsg.post<PalletRow>("/pallet/open",
      { mo_no: mo, line_code: line, po_no: po, tpl_code: init?.pallet_tpl_code || "" }));
    setBusy(false);
    if (e) { setErr(e); return; }
    setMsg(d?.msg || t("w12.pallet.opened", locale));
    void loadInit(); void loadList();
  };

  const addBox = async () => {
    const code = boxNo.trim();
    if (!code || !open) return;
    setBusy(true); setErr(""); setMsg("");
    const [d, e] = await call(() => mesrjMsg.post("/pallet/box/add", { pallet_no: open.pallet_no, box_no: code }));
    setBusy(false);
    if (e) { setErr(e); return; }
    setMsg(d?.msg || t("w12.pallet.box_added", locale));
    setBoxNo("");
    void loadInit(); void loadList();
  };

  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 10 }}>{t("menu.exec.pallet", locale)}</div>
      <Ok msg={msg} /><Err msg={err} />

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
        <select value={mo} onChange={ev => setMo(ev.target.value)} style={{ ...inp, minWidth: 280 }}>
          <option value="">{t("w12.common.mo_no", locale)}</option>
          {mos.map(m => (
            <option key={m.mo_no} value={m.mo_no}>
              {`${m.mo_no} · ${m.product_code || ""} · ${m.status || ""} · ${m.done_qty ?? 0}/${m.plan_qty ?? 0}`}
            </option>
          ))}
        </select>
        <input style={{ ...inp, width: 130 }} placeholder={t("w12.common.line_code", locale)}
          value={line} onChange={ev => setLine(ev.target.value)} />
        <input style={{ ...inp, width: 150 }} placeholder={t("w12.common.po_no", locale)}
          value={po} onChange={ev => setPo(ev.target.value)} />
        <button {...btn} onClick={() => void loadInit()}>{t("common.refresh", locale)}</button>
        <button {...btnPrim} disabled={busy || !mo} onClick={() => void openPallet()}>
          {t("w12.pallet.open", locale)}
        </button>
      </div>

      {init && (
        <div style={{ ...box, fontSize: 13, display: "flex", gap: 18, flexWrap: "wrap" }}>
          <span>{t("w12.pallet.product", locale)}: <b>{init.product_code}</b></span>
          <span>{t("w12.pallet.carton_qty", locale)}: <b>{init.carton_qty}</b></span>
          <span>{t("w12.pallet.cartons_per_pallet", locale)}: <b>{init.cartons_per_pallet}</b></span>
          <span>{t("w12.pallet.plan_out", locale)}: <b>{`${init.out_qty}/${init.plan_qty}`}</b></span>
        </div>
      )}

      {open && (
        <div style={box}>
          <div style={{ fontSize: 13, marginBottom: 6 }}>
            {`${t("w12.pallet.pallet_no", locale)}: ${open.pallet_no} · ${t("w12.pallet.qty", locale)}: ${open.total_qty}` +
              ` · ${open.box_count}/${open.capacity} ${t("w12.pallet.boxes", locale)}`}
          </div>
          <div style={{ height: 10, background: "#e2e8f0", borderRadius: 5, overflow: "hidden", marginBottom: 8 }}>
            <div style={{ height: "100%", width: `${Math.min(100, (open.box_count / Math.max(1, open.capacity)) * 100)}%`, background: "#2563eb" }} />
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
            <input style={{ ...inp, width: 280 }} placeholder={t("w12.pallet.box_ph", locale)}
              value={boxNo} onChange={ev => setBoxNo(ev.target.value)}
              onKeyDown={ev => { if (ev.key === "Enter") void addBox(); }} />
            <button {...btnPrim} disabled={busy || !boxNo.trim()} onClick={() => void addBox()}>
              {t("w12.pallet.box_add", locale)}
            </button>
            <button {...btnWarn} disabled={busy} onClick={() => void act("/pallet/close",
              { pallet_no: open.pallet_no }, t("w12.pallet.close_confirm", locale))}>
              {t("w12.pallet.close", locale)}
            </button>
            <button {...btn} disabled={busy} onClick={() => {
              const code = window.prompt(t("w12.pallet.box_no", locale), "");
              if (!code) return;
              void act("/pallet/box/remove", { pallet_no: open.pallet_no, box_no: code });
            }}>{t("w12.pallet.box_remove", locale)}</button>
            <button {...btn} disabled={busy} onClick={() => void act("/pallet/reprint",
              { pallet_no: open.pallet_no })}>{t("w12.pallet.reprint", locale)}</button>
            <button {...btn} disabled={busy} onClick={() => {
              const target = window.prompt(t("w12.pallet.to_po", locale), "");
              if (!target) return;
              const reason = window.prompt(t("w12.pallet.reason", locale), "") || "";
              void act("/pallet/change-po", { pallet_no: open.pallet_no, to_po: target, reason });
            }}>{t("w12.pallet.change_po", locale)}</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 4 }}>
            {(open.boxes || []).map(b => (
              <div key={b.box_no} title={`${b.box_no} ${b.status}`}
                style={{ border: "1px solid var(--border, #e2e8f0)", borderRadius: 6, padding: 4, fontSize: 11 }}>
                <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.box_no}</div>
                <div style={{ color: "#64748b" }}>{`${b.qty} · ${b.status}`}</div>
              </div>
            ))}
            {!(open.boxes || []).length && <div style={{ fontSize: 13, color: "#64748b" }}>{t("w12.pallet.empty", locale)}</div>}
          </div>
        </div>
      )}

      <div style={box}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>{t("w12.pallet.list", locale)}</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              <th style={th}>{t("w12.pallet.pallet_no", locale)}</th>
              <th style={th}>{t("w12.common.mo_no", locale)}</th>
              <th style={th}>{t("w12.common.po_no", locale)}</th>
              <th style={th}>{t("w12.common.line_code", locale)}</th>
              <th style={th}>{t("w12.pallet.boxes", locale)}</th>
              <th style={th}>{t("w12.pallet.qty", locale)}</th>
              <th style={th}>{t("w12.pallet.status", locale)}</th>
              <th style={th}>{t("common.actions", locale)}</th>
            </tr></thead>
            <tbody>
              {list.map(r => (
                <tr key={r.pallet_no}>
                  <td style={{ ...td, fontWeight: 600 }}>{r.pallet_no}</td>
                  <td style={td}>{r.mo_no}</td>
                  <td style={td}>{r.po_no || "—"}</td>
                  <td style={td}>{r.line_code || "—"}</td>
                  <td style={td}>{`${r.box_count}/${r.capacity}`}</td>
                  <td style={td}>{r.total_qty}</td>
                  <td style={td}>{r.status}</td>
                  <td style={td}>
                    {r.status === "已封板" && (
                      <button {...btn} disabled={busy} onClick={() => void act("/pallet/reopen", { pallet_no: r.pallet_no })}>
                        {t("w12.pallet.reopen", locale)}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!list.length && <tr><td colSpan={8} style={{ ...tdMuted, padding: 12 }}>{t("common.noData", locale)}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div style={box}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>{t("w12.pallet.po_log", locale)}</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              <th style={th}>{t("w12.pallet.pallet_no", locale)}</th>
              <th style={th}>{t("w12.common.mo_no", locale)}</th>
              <th style={th}>{t("w12.pallet.from_po", locale)}</th>
              <th style={th}>{t("w12.pallet.to_po", locale)}</th>
              <th style={th}>{t("w12.pallet.qty", locale)}</th>
              <th style={th}>{t("w12.pallet.reason", locale)}</th>
              <th style={th}>{t("w12.pallet.operator", locale)}</th>
              <th style={th}>{t("w12.common.time", locale)}</th>
            </tr></thead>
            <tbody>
              {poLog.map(r => (
                <tr key={r.id}>
                  <td style={td}>{r.pallet_no}</td>
                  <td style={td}>{r.mo_no}</td>
                  <td style={td}>{r.from_po || "—"}</td>
                  <td style={{ ...td, color: "#15803d" }}>{r.to_po}</td>
                  <td style={td}>{r.qty}</td>
                  <td style={{ ...td, color: "#64748b" }}>{r.reason || "—"}</td>
                  <td style={td}>{r.operator || "—"}</td>
                  <td style={tdMuted}>{(r.created_at || "").slice(0, 16).replace("T", " ")}</td>
                </tr>
              ))}
              {!poLog.length && <tr><td colSpan={8} style={{ ...tdMuted, padding: 12 }}>{t("common.noData", locale)}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 4. 维修交接（exec.repairhandover）—— 源 repair.py 交接单
// ════════════════════════════════════════════════════════════════════════════
interface PendingRow { id: number; sn: string; station_code: string; defect_code: string; defect_desc: string; handle: string; defect_time: string; line_code: string; product_code: string; }
interface HandoverRow {
  id: number; handover_no: string; handover_date: string; line_code: string; station_code: string;
  mo_no: string; from_by: string; to_by: string; qty: number; repaired_qty: number; scrap_qty: number;
  pending_qty: number; status: string; remark: string; created_at: string;
}
interface HandoverItem {
  id: number; handover_no: string; sn: string; defect_code: string; defect_desc: string;
  result: string; root_cause: string; action: string; repair_by: string; repair_time: string; remark: string;
}
interface HandoverDetail { handover: HandoverRow; items: HandoverItem[]; }
interface PendingSummary { rows: Array<{ station_code: string; qty: number; first_at: string; last_at: string; defects: string; line_code: string }>; total: number; }
interface RepairSummary {
  daily: Array<{ d: string; orders: number; qty: number; ok: number; ng: number; wait: number }>;
  total: { orders: number; qty: number; ok: number; ng: number; wait: number; ok_rate: number; ng_rate: number };
}

export function RepairHandoverView({ locale }: { locale: Locale }) {
  const [tab, setTab] = useState<"pending" | "handover" | "summary">("pending");
  const [pending, setPending] = useState<PendingRow[]>([]);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [summary, setSummary] = useState<PendingSummary | null>(null);
  const [handovers, setHandovers] = useState<HandoverRow[]>([]);
  const [detail, setDetail] = useState<HandoverDetail | null>(null);
  const [repairSummary, setRepairSummary] = useState<RepairSummary | null>(null);
  const [station, setStation] = useState("");
  const [toBy, setToBy] = useState("");
  const [kw, setKw] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const loadPending = useCallback(async () => {
    const [d, e] = await call(() => mesrjApi.get<PendingRow[]>("/repair/pending", { kw, size: 500 }));
    if (e || !d) { setErr(e || "未返回数据"); return; }
    setPending(d || []);
  }, [kw]);
  const loadSummary = useCallback(async () => {
    const [d, e] = await call(() => mesrjApi.get<PendingSummary>("/repair/pending-summary"));
    if (e) setErr(e); else setSummary(d);
  }, []);
  const loadHandovers = useCallback(async () => {
    const [d, e] = await call(() => mesrjApi.get<{ list: HandoverRow[]; total: number }>("/repair/handover", { kw, pageSize: 50 }));
    if (e) setErr(e); else setHandovers(d?.list || []);
  }, [kw]);
  const loadRepairSummary = useCallback(async () => {
    const [d, e] = await call(() => mesrjApi.get<RepairSummary>("/repair/summary", { days: 30 }));
    if (e) setErr(e); else setRepairSummary(d);
  }, []);

  useEffect(() => { void loadPending(); void loadSummary(); void loadHandovers(); void loadRepairSummary(); },
    [loadPending, loadSummary, loadHandovers, loadRepairSummary]);

  const openDetail = async (no: string) => {
    const [d, e] = await call(() => mesrjApi.get<HandoverDetail>(`/repair/handover/${encodeURIComponent(no)}`));
    if (e || !d) { setErr(e || "未返回数据"); return; }
    setDetail(d);
  };

  const createHandover = async () => {
    const sns = Object.keys(picked).filter(k => picked[k]);
    if (!station.trim()) { setErr(t("w12.repair.station_required", locale)); return; }
    if (!sns.length) { setErr(t("w12.repair.sns_required", locale)); return; }
    setBusy(true); setErr(""); setMsg("");
    const [d, e] = await call(() => mesrjMsg.post<{ handover_no: string }>("/repair/handover",
      { station_code: station.trim(), to_by: toBy.trim(), sns }));
    setBusy(false);
    if (e) { setErr(e); return; }
    setMsg(d?.msg || t("w12.repair.created", locale));
    setPicked({});
    void loadPending(); void loadHandovers();
  };

  const handoverAct = async (no: string, action: string, body: Record<string, unknown> = {}) => {
    setBusy(true); setErr(""); setMsg("");
    const [d, e] = await call(() => mesrjMsg.post(`/repair/handover/${encodeURIComponent(no)}/${action}`, body));
    setBusy(false);
    if (e) { setErr(e); return; }
    setMsg(d?.msg || t("w12.common.saved", locale));
    void loadHandovers(); void loadPending();
    if (detail?.handover.handover_no === no) void openDetail(no);
  };

  const registerItem = async (no: string, sn: string) => {
    const result = window.prompt(t("w12.repair.result_ph", locale), "已修复");
    if (!result) return;
    const root = window.prompt(t("w12.repair.root_cause", locale), "") || "";
    const action = window.prompt(t("w12.repair.action", locale), "") || "";
    void handoverAct(no, "item", { sn, result, root_cause: root, action });
  };

  const autoGen = async () => {
    setBusy(true); setErr(""); setMsg("");
    const [d, e] = await call(() => mesrjMsg.post<{ made: Array<{ handover_no: string }> }>(
      "/repair/auto-gen", { force: true }));
    setBusy(false);
    if (e) { setErr(e); return; }
    setMsg(d?.msg || `${t("w12.repair.auto_gen", locale)} ${d?.data?.made?.length ?? 0}`);
    void loadPending(); void loadHandovers(); void loadSummary(); void loadRepairSummary();
  };

  const tabs: Array<{ key: typeof tab; label: string }> = [
    { key: "pending", label: t("w12.repair.tab_pending", locale) },
    { key: "handover", label: t("w12.repair.tab_handover", locale) },
    { key: "summary", label: t("w12.repair.tab_summary", locale) },
  ];

  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 10 }}>{t("menu.exec.repairhandover", locale)}</div>
      <Ok msg={msg} /><Err msg={err} />

      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {tabs.map(x => (
          <button key={x.key} {...(tab === x.key ? btnPrim : btn)} onClick={() => setTab(x.key)}>{x.label}</button>
        ))}
        <input style={{ ...inp, width: 180, marginLeft: "auto" }} placeholder={t("w12.repair.kw_ph", locale)}
          value={kw} onChange={ev => setKw(ev.target.value)} />
        <button {...btn} onClick={() => { void loadPending(); void loadHandovers(); }}>{t("common.search", locale)}</button>
      </div>

      {tab === "pending" && (
        <>
          {summary && (
            <div style={{ ...box, fontSize: 13 }}>
              {t("w12.repair.pending_total", locale)}: <b>{summary.total}</b>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 6 }}>
                {(summary.rows || []).map(r => (
                  <span key={r.station_code} style={{ padding: "2px 8px", borderRadius: 10, background: "#fef3c7" }}>
                    {`${r.station_code || "—"}：${r.qty}`}
                  </span>
                ))}
              </div>
            </div>
          )}
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
            <input style={{ ...inp, width: 160 }} placeholder={t("w12.repair.station_ph", locale)}
              value={station} onChange={ev => setStation(ev.target.value)} />
            <input style={{ ...inp, width: 150 }} placeholder={t("w12.repair.to_by", locale)}
              value={toBy} onChange={ev => setToBy(ev.target.value)} />
            <button {...btnPrim} disabled={busy} onClick={() => void createHandover()}>
              {`${t("w12.repair.create", locale)}（${Object.values(picked).filter(Boolean).length}）`}
            </button>
            <button {...btn} disabled={busy} onClick={() => void autoGen()}>
              {t("w12.repair.auto_gen", locale)}
            </button>
          </div>
          <div style={box}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>
                <th style={{ ...th, width: 30 }} />
                <th style={th}>SN</th>
                <th style={th}>{t("w12.repair.station", locale)}</th>
                <th style={th}>{t("w12.repair.defect", locale)}</th>
                <th style={th}>{t("w12.repair.defect_desc", locale)}</th>
                <th style={th}>{t("w12.common.line_code", locale)}</th>
                <th style={th}>{t("w12.common.time", locale)}</th>
              </tr></thead>
              <tbody>
                {pending.map(r => (
                  <tr key={r.id}>
                    <td style={td}>
                      <input type="checkbox" checked={Boolean(picked[r.sn])}
                        onChange={ev => setPicked(s => ({ ...s, [r.sn]: ev.target.checked }))} />
                    </td>
                    <td style={{ ...td, fontWeight: 600 }}>{r.sn}</td>
                    <td style={td}>{r.station_code || "—"}</td>
                    <td style={td}>{r.defect_code || "—"}</td>
                    <td style={{ ...td, color: "#64748b" }}>{r.defect_desc || "—"}</td>
                    <td style={td}>{r.line_code || "—"}</td>
                    <td style={tdMuted}>{(r.defect_time || "").slice(0, 16).replace("T", " ")}</td>
                  </tr>
                ))}
                {!pending.length && <tr><td colSpan={7} style={{ ...tdMuted, padding: 12 }}>{t("common.noData", locale)}</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "handover" && (
        <>
          <div style={box}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>
                <th style={th}>{t("w12.repair.handover_no", locale)}</th>
                <th style={th}>{t("w12.repair.date", locale)}</th>
                <th style={th}>{t("w12.common.line_code", locale)}</th>
                <th style={th}>{t("w12.repair.station", locale)}</th>
                <th style={th}>{t("w12.repair.qty", locale)}</th>
                <th style={th}>{t("w12.repair.ok", locale)}</th>
                <th style={th}>{t("w12.repair.ng", locale)}</th>
                <th style={th}>{t("w12.repair.wait", locale)}</th>
                <th style={th}>{t("w12.repair.status", locale)}</th>
                <th style={th}>{t("common.actions", locale)}</th>
              </tr></thead>
              <tbody>
                {handovers.map(h => (
                  <tr key={h.id}>
                    <td style={{ ...td, fontWeight: 600 }}>{h.handover_no}</td>
                    <td style={td}>{h.handover_date}</td>
                    <td style={td}>{h.line_code || "—"}</td>
                    <td style={td}>{h.station_code || "—"}</td>
                    <td style={td}>{h.qty}</td>
                    <td style={{ ...td, color: "#15803d" }}>{h.repaired_qty}</td>
                    <td style={{ ...td, color: "#b91c1c" }}>{h.scrap_qty}</td>
                    <td style={{ ...td, color: "#b45309" }}>{h.pending_qty}</td>
                    <td style={td}>{h.status}</td>
                    <td style={td}>
                      <button {...btn} onClick={() => void openDetail(h.handover_no)}>{t("w12.repair.detail", locale)}</button>
                      {h.status === "待接收" && (
                        <button {...btnPrim} disabled={busy} onClick={() => void handoverAct(h.handover_no, "accept")}>
                          {t("w12.repair.accept", locale)}
                        </button>
                      )}
                      {h.status === "维修中" && (
                        <button {...btnWarn} disabled={busy} onClick={() => void handoverAct(h.handover_no, "close")}>
                          {t("w12.repair.close", locale)}
                        </button>
                      )}
                      {h.status !== "已完成" && h.status !== "已退回" && (
                        <button {...btn} disabled={busy} onClick={() => {
                          const reason = window.prompt(t("w12.repair.return_reason", locale), "") || "";
                          void handoverAct(h.handover_no, "return", { reason });
                        }}>{t("w12.repair.return", locale)}</button>
                      )}
                    </td>
                  </tr>
                ))}
                {!handovers.length && <tr><td colSpan={10} style={{ ...tdMuted, padding: 12 }}>{t("common.noData", locale)}</td></tr>}
              </tbody>
            </table>
          </div>

          {detail && (
            <div style={box}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>
                {`${detail.handover.handover_no} · ${detail.handover.status}`}
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>
                  <th style={th}>SN</th>
                  <th style={th}>{t("w12.repair.defect", locale)}</th>
                  <th style={th}>{t("w12.repair.result", locale)}</th>
                  <th style={th}>{t("w12.repair.root_cause", locale)}</th>
                  <th style={th}>{t("w12.repair.action", locale)}</th>
                  <th style={th}>{t("w12.repair.repair_by", locale)}</th>
                  <th style={th}>{t("common.actions", locale)}</th>
                </tr></thead>
                <tbody>
                  {(detail.items || []).map(it => (
                    <tr key={it.id}>
                      <td style={{ ...td, fontWeight: 600 }}>{it.sn}</td>
                      <td style={td}>{it.defect_code || "—"}</td>
                      <td style={td}>{it.result}</td>
                      <td style={{ ...td, color: "#64748b" }}>{it.root_cause || "—"}</td>
                      <td style={{ ...td, color: "#64748b" }}>{it.action || "—"}</td>
                      <td style={td}>{it.repair_by || "—"}</td>
                      <td style={td}>
                        <button {...btn} disabled={busy} onClick={() => void registerItem(detail.handover.handover_no, it.sn)}>
                          {t("w12.repair.register", locale)}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === "summary" && repairSummary && (
        <>
          <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
            {[
              [t("w12.repair.orders", locale), repairSummary.total.orders],
              [t("w12.repair.qty", locale), repairSummary.total.qty],
              [t("w12.repair.ok", locale), repairSummary.total.ok],
              [t("w12.repair.ng", locale), repairSummary.total.ng],
              [t("w12.repair.wait", locale), repairSummary.total.wait],
              [`${t("w12.repair.ok_rate", locale)} %`, repairSummary.total.ok_rate],
              [`${t("w12.repair.ng_rate", locale)} %`, repairSummary.total.ng_rate],
            ].map(([k, v]) => (
              <div key={String(k)} style={{ ...box, marginBottom: 0, flex: 1, minWidth: 110 }}>
                <div style={{ fontSize: 12, color: "#64748b" }}>{k}</div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{String(v)}</div>
              </div>
            ))}
          </div>
          <div style={box}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>
                <th style={th}>{t("w12.repair.date", locale)}</th>
                <th style={th}>{t("w12.repair.orders", locale)}</th>
                <th style={th}>{t("w12.repair.qty", locale)}</th>
                <th style={th}>{t("w12.repair.ok", locale)}</th>
                <th style={th}>{t("w12.repair.ng", locale)}</th>
                <th style={th}>{t("w12.repair.wait", locale)}</th>
              </tr></thead>
              <tbody>
                {(repairSummary.daily || []).map(r => (
                  <tr key={r.d}>
                    <td style={td}>{r.d}</td>
                    <td style={td}>{r.orders}</td>
                    <td style={td}>{r.qty}</td>
                    <td style={{ ...td, color: "#15803d" }}>{r.ok}</td>
                    <td style={{ ...td, color: "#b91c1c" }}>{r.ng}</td>
                    <td style={{ ...td, color: "#b45309" }}>{r.wait}</td>
                  </tr>
                ))}
                {!repairSummary.daily.length && <tr><td colSpan={6} style={{ ...tdMuted, padding: 12 }}>{t("common.noData", locale)}</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 5. 解报废审批（exec.scraprelease）
// ════════════════════════════════════════════════════════════════════════════
interface ReleaseRow {
  id: number; sn: string; station_code: string; defect_code: string; reason: string;
  status: string; approved_by: string; approved_at: string; created_by: string;
  created_at: string; consumed: number;
}
interface CheckResult { sn: string; sn_status: string; release: ReleaseRow | null; can_repair: boolean; }

export function ScrapReleaseView({ locale }: { locale: Locale }) {
  const [rows, setRows] = useState<ReleaseRow[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [sn, setSn] = useState("");
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [d, e] = await call(() => mesrjApi.get<{ rows: ReleaseRow[]; total: number }>(
      "/repair/scrap/release/list", { status: statusFilter }));
    if (e || !d) { setErr(e || "未返回数据"); return; }
    setRows(d.rows || []);
  }, [statusFilter]);
  useEffect(() => { void load(); }, [load]);

  const doCheck = async () => {
    const code = sn.trim();
    if (!code) return;
    const [d, e] = await call(() => mesrjApi.get<CheckResult>("/repair/scrap/release/check", { sn: code }));
    if (e) { setErr(e); setCheck(null); return; }
    setCheck(d);
  };

  const apply = async () => {
    const code = sn.trim();
    if (!code) { setErr(t("w12.release.sn_required", locale)); return; }
    const reason = window.prompt(t("w12.release.reason", locale), "") || "";
    setBusy(true); setErr(""); setMsg("");
    const [d, e] = await call(() => mesrjMsg.post("/repair/scrap/release/apply", { sn: code, reason }));
    setBusy(false);
    if (e) { setErr(e); return; }
    setMsg(d?.msg || t("w12.common.saved", locale));
    void load(); void doCheck();
  };

  const approve = async (r: ReleaseRow, ok: boolean) => {
    const remark = ok ? "" : (window.prompt(t("w12.release.reject_reason", locale), "") || "");
    setBusy(true); setErr(""); setMsg("");
    const [d, e] = await call(() => mesrjMsg.post("/repair/scrap/release/approve",
      { release_no: r.sn, approve: ok, remark }));
    setBusy(false);
    if (e) { setErr(e); return; }
    setMsg(d?.msg || (ok ? t("w12.release.approved", locale) : t("w12.release.rejected", locale)));
    void load();
  };

  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 10 }}>{t("menu.exec.scraprelease", locale)}</div>
      <Ok msg={msg} /><Err msg={err} />

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <input style={{ ...inp, width: 220 }} placeholder={t("w12.release.sn_ph", locale)}
          value={sn} onChange={ev => setSn(ev.target.value)}
          onKeyDown={ev => { if (ev.key === "Enter") void doCheck(); }} />
        <button {...btn} onClick={() => void doCheck()}>{t("w12.release.check", locale)}</button>
        <button {...btnPrim} disabled={busy || !sn.trim()} onClick={() => void apply()}>
          {t("w12.release.apply", locale)}
        </button>
        <select style={{ ...inp, minWidth: 140 }} value={statusFilter}
          onChange={ev => setStatusFilter(ev.target.value)}>
          <option value="">{t("w12.release.all_status", locale)}</option>
          <option value="待批准">{t("w12.release.pending", locale)}</option>
          <option value="已批准">{t("w12.release.approved", locale)}</option>
          <option value="已拒绝">{t("w12.release.rejected", locale)}</option>
        </select>
        <button {...btn} onClick={() => void load()}>{t("common.refresh", locale)}</button>
      </div>

      {check && (
        <div style={{ ...box, fontSize: 13 }}>
          <span>SN: <b>{check.sn}</b></span>
          <span style={{ marginLeft: 16 }}>{t("w12.release.sn_status", locale)}: <b>{check.sn_status || "—"}</b></span>
          <span style={{ marginLeft: 16, color: check.can_repair ? "#15803d" : "#b91c1c" }}>
            {t("w12.release.can_repair", locale)}: <b>{check.can_repair ? t("common.yes", locale) : t("common.no", locale)}</b>
          </span>
          {check.release && (
            <span style={{ marginLeft: 16 }}>
              {t("w12.release.current", locale)}: <b>{`${check.release.status} · ${check.release.reason || "—"}`}</b>
            </span>
          )}
        </div>
      )}

      <div style={box}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>
            <th style={th}>SN</th>
            <th style={th}>{t("w12.repair.station", locale)}</th>
            <th style={th}>{t("w12.repair.defect", locale)}</th>
            <th style={th}>{t("w12.release.reason", locale)}</th>
            <th style={th}>{t("w12.repair.status", locale)}</th>
            <th style={th}>{t("w12.release.approved_by", locale)}</th>
            <th style={th}>{t("w12.release.created_by", locale)}</th>
            <th style={th}>{t("w12.common.time", locale)}</th>
            <th style={th}>{t("common.actions", locale)}</th>
          </tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.sn}-${i}`}>
                <td style={{ ...td, fontWeight: 600 }}>{r.sn}</td>
                <td style={td}>{r.station_code || "—"}</td>
                <td style={td}>{r.defect_code || "—"}</td>
                <td style={{ ...td, color: "#64748b" }}>{r.reason || "—"}</td>
                <td style={td}>{r.status}</td>
                <td style={td}>{r.approved_by || "—"}</td>
                <td style={td}>{r.created_by || "—"}</td>
                <td style={tdMuted}>{(r.created_at || "").slice(0, 16).replace("T", " ")}</td>
                <td style={td}>
                  {r.status === "待批准" && (
                    <>
                      <button {...btnPrim} disabled={busy} onClick={() => void approve(r, true)}>
                        {t("w12.release.approve", locale)}
                      </button>
                      <button {...btnDanger} disabled={busy} onClick={() => void approve(r, false)}>
                        {t("w12.release.reject", locale)}
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={9} style={{ ...tdMuted, padding: 12 }}>{t("common.noData", locale)}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 6. 维修看板（qlt.repairboard）—— 积压按工位 + 交接进度
// ════════════════════════════════════════════════════════════════════════════
export function RepairBoardView({ locale }: { locale: Locale }) {
  const [summary, setSummary] = useState<PendingSummary | null>(null);
  const [repairSummary, setRepairSummary] = useState<RepairSummary | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    const [a, ea] = await call(() => mesrjApi.get<PendingSummary>("/repair/pending-summary"));
    if (ea) setErr(ea); else setSummary(a);
    const [b, eb] = await call(() => mesrjApi.get<RepairSummary>("/repair/summary", { days: 14 }));
    if (eb) setErr(eb); else setRepairSummary(b);
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 10 }}>{t("menu.qlt.repairboard", locale)}</div>
      <Err msg={err} />
      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <div style={{ ...box, marginBottom: 0, flex: 1, minWidth: 160 }}>
          <div style={{ fontSize: 12, color: "#64748b" }}>{t("w12.repair.pending_total", locale)}</div>
          <div style={{ fontSize: 30, fontWeight: 700, color: "#b45309" }}>{summary?.total ?? 0}</div>
        </div>
        <div style={{ ...box, marginBottom: 0, flex: 1, minWidth: 160 }}>
          <div style={{ fontSize: 12, color: "#64748b" }}>{t("w12.repair.orders", locale)}</div>
          <div style={{ fontSize: 30, fontWeight: 700 }}>{repairSummary?.total.orders ?? 0}</div>
        </div>
        <div style={{ ...box, marginBottom: 0, flex: 1, minWidth: 160 }}>
          <div style={{ fontSize: 12, color: "#64748b" }}>{`${t("w12.repair.ok_rate", locale)} %`}</div>
          <div style={{ fontSize: 30, fontWeight: 700, color: "#15803d" }}>{repairSummary?.total.ok_rate ?? 0}</div>
        </div>
        <div style={{ ...box, marginBottom: 0, flex: 1, minWidth: 160 }}>
          <div style={{ fontSize: 12, color: "#64748b" }}>{`${t("w12.repair.ng_rate", locale)} %`}</div>
          <div style={{ fontSize: 30, fontWeight: 700, color: "#b91c1c" }}>{repairSummary?.total.ng_rate ?? 0}</div>
        </div>
      </div>

      <div style={box}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>{t("w12.repair.by_station", locale)}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10 }}>
          {(summary?.rows || []).map(r => (
            <div key={r.station_code} style={{ border: "1px solid var(--border, #e2e8f0)", borderRadius: 8, padding: 10 }}>
              <div style={{ fontWeight: 700 }}>{r.station_code || "—"}</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: "#b45309" }}>{r.qty}</div>
              <div style={{ fontSize: 11, color: "#64748b" }}>{r.line_code || "—"}</div>
              <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>{r.defects || "—"}</div>
            </div>
          ))}
          {!(summary?.rows || []).length && <div style={{ fontSize: 13, color: "#64748b" }}>{t("common.noData", locale)}</div>}
        </div>
      </div>

      {repairSummary && (
        <div style={box}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>{t("w12.repair.daily", locale)}</div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 120 }}>
            {repairSummary.daily.map(r => {
              const max = Math.max(1, ...repairSummary.daily.map(x => Number(x.qty || 0)));
              return (
                <div key={r.d} title={`${r.d}: ${r.qty}`} style={{ flex: 1, textAlign: "center" }}>
                  <div style={{ height: Math.round((Number(r.qty) / max) * 90), background: "#93c5fd", borderRadius: 2 }} />
                  <div style={{ fontSize: 9, color: "#94a3b8" }}>{r.d.slice(5)}</div>
                </div>
              );
            })}
          </div>
          {!repairSummary.daily.length && <div style={{ fontSize: 13, color: "#64748b" }}>{t("common.noData", locale)}</div>}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 7. 维修作业台（qlt.repairdesk）—— 扫码上下文 + 维修单明细
// ════════════════════════════════════════════════════════════════════════════
interface SnContext {
  sn: string; exists: boolean;
  base: { sn: string; product_code?: string; mo_no?: string; status?: string; cur_station?: string; product_model?: string; product_name?: string } | null;
  defects: Array<{ defect_code?: string; defect_name?: string; defect_desc?: string; station_code?: string; handle?: string; defect_time?: string; root_cause?: string }>;
  history: RepairDetailRow[];
  repairTimes: number; canRepair: boolean; blockReason: string;
}
interface RepairDetailRow {
  id?: number; repair_no: string; sn: string; defect_station?: string; defect_code?: string;
  defect_name?: string; defect_phenomenon?: string; disposition?: string; disposition_name?: string;
  verify_source?: string; verify_status?: string; root_cause?: string; repair_by?: string;
  repair_time?: string; remark?: string; [key: string]: unknown;
}
interface DispositionRow { code: string; name_cn: string; name_en: string; name_vi: string; need_part: number; }
interface DesignatorRow { designator: string; material_code: string; material_name: string; part_no?: string; [key: string]: unknown; }

export function RepairDeskView({ locale, initialSn }: { locale: Locale; initialSn?: string }) {
  const [sn, setSn] = useState(initialSn || "");
  const [ctx, setCtx] = useState<SnContext | null>(null);
  const [details, setDetails] = useState<RepairDetailRow[]>([]);
  const [disps, setDisps] = useState<DispositionRow[]>([]);
  const [station, setStation] = useState("");
  const [defect, setDefect] = useState("");
  const [phenomenon, setPhenomenon] = useState("");
  const [disposition, setDisposition] = useState("");
  const [rootCause, setRootCause] = useState("");
  const [remark, setRemark] = useState("");
  const [vs, setVs] = useState("ATE复测");
  const [vsReason, setVsReason] = useState("");
  const [partCode, setPartCode] = useState("");
  const [partDc, setPartDc] = useState("");
  const [partPos, setPartPos] = useState("");
  const [partQty, setPartQty] = useState("1");
  const [desigQ, setDesigQ] = useState("");
  const [desigRows, setDesigRows] = useState<DesignatorRow[]>([]);
  const [stats, setStats] = useState<{ stats: Record<string, unknown> } | null>(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const loadSn = useCallback(async () => {
    const code = sn.trim();
    if (!code) { setCtx(null); setDetails([]); return; }
    setErr(""); setMsg("");
    const [c, e] = await call(() => mesrjApi.get<SnContext>("/repair/sn/context", { sn: code }));
    if (e) { setErr(e); setCtx(null); } else setCtx(c);
    const [d, ed] = await call(() => mesrjApi.get<{ rows: RepairDetailRow[] }>("/repair/detail", { sn: code }));
    if (ed) setErr(ed); else setDetails(d?.rows || []);
  }, [sn]);

  const loadDisps = useCallback(async () => {
    const [d, e] = await call(() => mesrjApi.get<{ rows: DispositionRow[] }>("/repair/dispositions"));
    if (e) { setErr(e); return; }
    setDisps(d?.rows || []);
  }, []);
  useEffect(() => { void loadDisps(); }, [loadDisps]);
  // 从不良记录页「去维修」带 SN 进来时，直接查一次上下文（否则输入框有值但不加载）
  useEffect(() => { if (initialSn) void loadSn(); }, [initialSn]);  // eslint-disable-line react-hooks/exhaustive-deps

  const loadStats = useCallback(async () => {
    const [d, e] = await call(() => mesrjApi.get<{ stats: Record<string, unknown> }>("/repair/stats", { days: 14 }));
    if (e) setErr(e); else setStats(d);
  }, []);
  useEffect(() => { void loadStats(); }, [loadStats]);

  const dispLabel = (d: DispositionRow) =>
    locale === "vi-VN" ? (d.name_vi || d.name_cn) : locale === "en-US" ? (d.name_en || d.name_cn) : d.name_cn;
  const curDisp = disps.find(d => d.code === disposition) || null;
  const needPart = Boolean(curDisp && Number(curDisp.need_part) === 1);

  const submit = async () => {
    if (!sn.trim()) { setErr(t("w12.desk.sn_required", locale)); return; }
    if (!disposition) { setErr(t("w12.desk.disposition_required", locale)); return; }
    if (needPart && (!partCode.trim() || !partDc.trim())) { setErr(t("w12.desk.part_required", locale)); return; }
    if (vs === "人工判定" && !vsReason.trim()) { setErr(t("w12.desk.vs_reason_required", locale)); return; }
    setBusy(true); setErr(""); setMsg("");
    const [d, e] = await call(() => mesrjMsg.post<{ repair_no?: string }>("/repair/detail", {
      sn: sn.trim(), defect_station: station.trim(), defect_code: defect.trim(),
      defect_phenomenon: phenomenon.trim(), disposition,
      root_cause: rootCause, remark, verify_source: vs, verify_reason: vs.trim() ? vsReason : "",
      parts: needPart
        ? [{ material_code: partCode.trim(), dc_code: partDc.trim(), designator: partPos.trim(), qty: Number(partQty) || 1 }]
        : [],
    }));
    setBusy(false);
    if (e) { setErr(e); return; }
    setMsg(d?.msg || t("w12.desk.created", locale));
    setPartCode(""); setPartDc(""); setPartPos(""); setPartQty("1"); setRootCause(""); setRemark(""); setVsReason("");
    void loadSn(); void loadStats();
  };

  const lookupDesignator = async () => {
    if (!desigQ.trim()) return;
    const [d, e] = await call(() => mesrjApi.get<{ rows: DesignatorRow[]; product_code: string }>(
      "/repair/designator", { sn: sn.trim(), q: desigQ.trim() }));
    if (e) { setErr(e); return; }
    setDesigRows(d?.rows || []);
  };

  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 10 }}>{t("menu.qlt.repairdesk", locale)}</div>
      <Ok msg={msg} /><Err msg={err} />

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <input style={{ ...inp, width: 240, fontSize: 15 }} placeholder={t("w12.desk.sn_ph", locale)}
          value={sn} onChange={ev => setSn(ev.target.value)}
          onKeyDown={ev => { if (ev.key === "Enter") void loadSn(); }} />
        <button {...btnPrim} disabled={!sn.trim()} onClick={() => void loadSn()}>
          {t("w12.desk.load", locale)}
        </button>
        <input style={{ ...inp, width: 150 }} placeholder={t("w12.desk.desig_ph", locale)}
          value={desigQ} onChange={ev => setDesigQ(ev.target.value)} />
        <button {...btn} disabled={!desigQ.trim()} onClick={() => void lookupDesignator()}>
          {t("w12.desk.desig_lookup", locale)}
        </button>
      </div>

      {ctx && (
        <div style={{ ...box, fontSize: 13 }}>
          <div>
            <b>{ctx.sn}</b>
            {ctx.base?.product_code ? ` · ${ctx.base.product_code}` : ""}
            {ctx.base?.mo_no ? ` · ${ctx.base.mo_no}` : ""}
            {ctx.base?.status ? ` · ${ctx.base.status}` : ""}
            {ctx.base?.cur_station ? ` · ${ctx.base.cur_station}` : ""}
            {` · ${t("w12.desk.repair_times", locale)} ${ctx.repairTimes ?? 0}`}
          </div>
          {!ctx.exists && <div style={{ color: "#b91c1c", marginTop: 4 }}>{t("w12.desk.not_exist", locale)}</div>}
          {ctx.canRepair === false && ctx.blockReason ? (
            <div style={{ color: "#b45309", marginTop: 4 }}>{ctx.blockReason}</div>
          ) : null}
          {ctx.defects?.length ? (
            <div style={{ marginTop: 6 }}>
              <span style={{ color: "#64748b" }}>{t("w12.desk.defects", locale)}: </span>
              {ctx.defects.map((d, i) => (
                <span key={i} style={{ marginRight: 10 }}>
                  {`${d.defect_code || "—"}(${d.station_code || "—"}) ${d.handle || ""}`}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      )}

      {desigRows.length > 0 && (
        <div style={box}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>{t("w12.desk.desig_result", locale)}</div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              <th style={th}>{t("w12.desk.designator", locale)}</th>
              <th style={th}>{t("w12.desk.material_code", locale)}</th>
              <th style={th}>{t("w12.desk.material_name", locale)}</th>
              <th style={th}>{t("w12.desk.part_no", locale)}</th>
            </tr></thead>
            <tbody>
              {desigRows.map((r, i) => (
                <tr key={i}>
                  <td style={td}>{String(r.designator || "—")}</td>
                  <td style={td}>{String(r.material_code || "—")}</td>
                  <td style={td}>{String(r.material_name || "—")}</td>
                  <td style={tdMuted}>{String(r.part_no || "—")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {stats && (
        <div style={{ ...box, fontSize: 13 }}>
          <span>{t("w12.desk.stats", locale)}</span>
          <pre style={{ margin: "6px 0 0", fontSize: 12, color: "#64748b", whiteSpace: "pre-wrap" }}>
            {`${t("w12.desk.stats_days", locale)} 14\n` + Object.entries(stats.stats || {}).map(([k, v]) => `${k}: ${String(v)}`).join("\n")}
          </pre>
        </div>
      )}

      <div style={box}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>{t("w12.desk.new_repair", locale)}</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          <input style={{ ...inp, width: 120 }} placeholder={t("w12.repair.station", locale)}
            value={station} onChange={ev => setStation(ev.target.value)} />
          <input style={{ ...inp, width: 110 }} placeholder={t("w12.repair.defect", locale)}
            value={defect} onChange={ev => setDefect(ev.target.value)} />
          <input style={{ ...inp, width: 200 }} placeholder={t("w12.desk.phenomenon", locale)}
            value={phenomenon} onChange={ev => setPhenomenon(ev.target.value)} />
          <select style={{ ...inp, minWidth: 150 }} value={disposition}
            onChange={ev => setDisposition(ev.target.value)}>
            <option value="">{t("w12.desk.disposition", locale)}</option>
            {disps.map(d => <option key={d.code} value={d.code}>{`${dispLabel(d)}${Number(d.need_part) === 1 ? " *" : ""}`}</option>)}
          </select>
          <input style={{ ...inp, width: 170 }} placeholder={t("w12.repair.root_cause", locale)}
            value={rootCause} onChange={ev => setRootCause(ev.target.value)} />
          <input style={{ ...inp, width: 170 }} placeholder={t("w12.layout.remark", locale)}
            value={remark} onChange={ev => setRemark(ev.target.value)} />
          <select style={inp} value={vs} onChange={ev => setVs(ev.target.value)}>
            <option value="ATE复测">{t("w12.desk.vs_ate", locale)}</option>
            <option value="人工判定">{t("w12.desk.vs_manual", locale)}</option>
          </select>
          {vs === "人工判定" && (
            <input style={{ ...inp, width: 170 }} placeholder={t("w12.desk.verify_reason", locale)}
              value={vsReason} onChange={ev => setVsReason(ev.target.value)} />
          )}
        </div>
        {needPart && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", padding: "8px 0", borderTop: "1px dashed var(--border, #e2e8f0)" }}>
            <span style={{ fontSize: 13, color: "#b45309", alignSelf: "center" }}>{t("w12.desk.part_title", locale)}</span>
            <input style={{ ...inp, width: 150 }} placeholder={t("w12.desk.material_code", locale)}
              value={partCode} onChange={ev => setPartCode(ev.target.value)} />
            <input style={{ ...inp, width: 120 }} placeholder={t("w12.desk.dc_code", locale)}
              value={partDc} onChange={ev => setPartDc(ev.target.value)} />
            <input style={{ ...inp, width: 90 }} placeholder={t("w12.desk.designator", locale)}
              value={partPos} onChange={ev => setPartPos(ev.target.value)} />
            <input style={{ ...inp, width: 70 }} type="number" placeholder={t("w12.repair.qty", locale)}
              value={partQty} onChange={ev => setPartQty(ev.target.value)} />
          </div>
        )}
        <div style={{ marginTop: 8 }}>
          <button {...btnPrim} disabled={busy} onClick={() => void submit()}>{t("common.save", locale)}</button>
        </div>
      </div>

      <div style={box}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>{t("w12.desk.history", locale)}</div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>
            <th style={th}>{t("w12.desk.repair_no", locale)}</th>
            <th style={th}>{t("w12.repair.station", locale)}</th>
            <th style={th}>{t("w12.repair.defect", locale)}</th>
            <th style={th}>{t("w12.desk.phenomenon", locale)}</th>
            <th style={th}>{t("w12.desk.disposition", locale)}</th>
            <th style={th}>{t("w12.desk.verify_status", locale)}</th>
            <th style={th}>{t("w12.repair.repair_by", locale)}</th>
            <th style={th}>{t("w12.common.time", locale)}</th>
          </tr></thead>
          <tbody>
            {details.map((r, i) => (
              <tr key={`${r.repair_no}-${i}`}>
                <td style={{ ...td, fontWeight: 600 }}>{r.repair_no || "—"}</td>
                <td style={td}>{r.defect_station || "—"}</td>
                <td style={td}>{r.defect_code || "—"}</td>
                <td style={{ ...td, color: "#64748b" }}>{r.defect_phenomenon || "—"}</td>
                <td style={td}>{r.disposition_name || r.disposition || "—"}</td>
                <td style={td}>{`${r.verify_source || ""}${r.verify_status ? ` / ${r.verify_status}` : ""}` || "—"}</td>
                <td style={td}>{r.repair_by || "—"}</td>
                <td style={tdMuted}>{(r.repair_time || "").slice(0, 16).replace("T", " ")}</td>
              </tr>
            ))}
            {!details.length && <tr><td colSpan={8} style={{ ...tdMuted, padding: 12 }}>{t("common.noData", locale)}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 8. 设备 OEE（report.oee）
// ════════════════════════════════════════════════════════════════════════════
interface OeeRow {
  station_code: string; machine_no: string; machine_type: string;
  total: number; ng: number; good: number; run_min: number;
  availability: number; performance: number; quality: number; oee: number;
}

export function OeeView({ locale }: { locale: Locale }) {
  const [rows, setRows] = useState<OeeRow[]>([]);
  const [d1, setD1] = useState("");
  const [d2, setD2] = useState("");
  const [line, setLine] = useState("");
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    const [d, e] = await call(() => mesrjApi.get<OeeRow[]>("/report/oee", { d1, d2, line }));
    if (e) setErr(e); else setRows(d || []);
  }, [d1, d2, line]);
  useEffect(() => { void load(); }, [load]);

  const avgOee = rows.length ? Math.round(rows.reduce((s, r) => s + Number(r.oee || 0), 0) / rows.length * 100) / 100 : 0;

  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 10 }}>{t("menu.report.oee", locale)}</div>
      <Err msg={err} />
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <input style={{ ...inp, width: 140 }} type="date" value={d1} onChange={ev => setD1(ev.target.value)} />
        <input style={{ ...inp, width: 140 }} type="date" value={d2} onChange={ev => setD2(ev.target.value)} />
        <input style={{ ...inp, width: 130 }} placeholder={t("w12.common.line_code", locale)}
          value={line} onChange={ev => setLine(ev.target.value)} />
        <button {...btnPrim} onClick={() => void load()}>{t("common.search", locale)}</button>
      </div>

      <div style={{ ...box, fontSize: 13, display: "flex", gap: 18 }}>
        <span>{t("w12.oee.devices", locale)}: <b>{rows.length}</b></span>
        <span>{t("w12.oee.avg", locale)}: <b style={{ color: avgOee >= 85 ? "#15803d" : avgOee >= 60 ? "#b45309" : "#dc2626" }}>{avgOee}%</b></span>
      </div>

      <div style={box}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>
            <th style={th}>{t("w12.repair.station", locale)}</th>
            <th style={th}>{t("w12.oee.machine", locale)}</th>
            <th style={th}>{t("w12.oee.type", locale)}</th>
            <th style={th}>{t("w12.oee.total", locale)}</th>
            <th style={th}>{t("w12.oee.ng", locale)}</th>
            <th style={th}>{t("w12.oee.good", locale)}</th>
            <th style={th}>{t("w12.oee.run_min", locale)}</th>
            <th style={th}>{t("w12.oee.availability", locale)}</th>
            <th style={th}>{t("w12.oee.performance", locale)}</th>
            <th style={th}>{t("w12.oee.quality", locale)}</th>
            <th style={th}>OEE</th>
          </tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.station_code}-${r.machine_no}-${i}`}>
                <td style={{ ...td, fontWeight: 600 }}>{r.station_code || "—"}</td>
                <td style={td}>{r.machine_no || "—"}</td>
                <td style={td}>{r.machine_type || "—"}</td>
                <td style={td}>{r.total}</td>
                <td style={{ ...td, color: "#b91c1c" }}>{r.ng}</td>
                <td style={{ ...td, color: "#15803d" }}>{r.good}</td>
                <td style={td}>{r.run_min}</td>
                <td style={td}>{r.availability}%</td>
                <td style={td}>{r.performance}%</td>
                <td style={td}>{r.quality}%</td>
                <td style={{ ...td, fontWeight: 700, color: Number(r.oee) >= 85 ? "#15803d" : Number(r.oee) >= 60 ? "#b45309" : "#dc2626" }}>
                  {r.oee}%
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={11} style={{ ...tdMuted, padding: 12 }}>{t("common.noData", locale)}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 9. SPC 过程控制（report.spc）
// ════════════════════════════════════════════════════════════════════════════
export function SpcView({ locale }: { locale: Locale }) {
  const [params, setParams] = useState<Array<Record<string, unknown>>>([]);
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    const [p, ep] = await call(() => mesrjApi.get<{ params: Array<Record<string, unknown>> }>("/report/spc/params"));
    if (ep) setErr(ep); else setParams(p?.params || []);
    const [r, er] = await call(() => mesrjApi.get<{ rows: Array<Record<string, unknown>> }>("/report/spc"));
    if (er) setErr(er); else setRows(r?.rows || []);
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 10 }}>{t("menu.report.spc", locale)}</div>
      <Err msg={err} />
      <div style={box}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>{t("w12.spc.params", locale)}</div>
        {params.length ? (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>{Object.keys(params[0]).map(k => <th key={k} style={th}>{k}</th>)}</tr></thead>
            <tbody>{params.map((r, i) => <tr key={i}>{Object.keys(params[0]).map(k => <td key={k} style={td}>{String(r[k] ?? "—")}</td>)}</tr>)}</tbody>
          </table>
        ) : <div style={{ fontSize: 13, color: "#64748b" }}>{t("w12.spc.empty", locale)}</div>}
      </div>
      <div style={box}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>{t("w12.spc.rows", locale)}</div>
        {rows.length ? (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>{Object.keys(rows[0]).map(k => <th key={k} style={th}>{k}</th>)}</tr></thead>
            <tbody>{rows.map((r, i) => <tr key={i}>{Object.keys(rows[0]).map(k => <td key={k} style={td}>{String(r[k] ?? "—")}</td>)}</tr>)}</tbody>
          </table>
        ) : <div style={{ fontSize: 13, color: "#64748b" }}>{t("w12.spc.empty", locale)}</div>}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 10. 产能看板（report.output）
// ════════════════════════════════════════════════════════════════════════════
export function OutputView({ locale }: { locale: Locale }) {
  const [list, setList] = useState<Array<Record<string, unknown>>>([]);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    const [d, e] = await call(() => mesrjApi.get<{ list: Array<Record<string, unknown>> }>("/report/output"));
    if (e) setErr(e); else setList(d?.list || []);
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 10 }}>{t("menu.report.output", locale)}</div>
      <Err msg={err} />
      <div style={box}>
        {list.length ? (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>{Object.keys(list[0]).map(k => <th key={k} style={th}>{k}</th>)}</tr></thead>
            <tbody>{list.map((r, i) => <tr key={i}>{Object.keys(list[0]).map(k => <td key={k} style={td}>{String(r[k] ?? "—")}</td>)}</tr>)}</tbody>
          </table>
        ) : <div style={{ fontSize: 13, color: "#64748b" }}>{t("w12.output.empty", locale)}</div>}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 11. 预警中心（report.alert）
// ════════════════════════════════════════════════════════════════════════════
interface AlertRule {
  id: number; rule_key: string; rule_name: string; source: string; cond: string;
  value: number; unit: string; level: string; action: string; enabled: number; remark: string;
}
interface AlertRow {
  id: number; rule_key: string; rule_name: string; level: string; title: string;
  detail: string; ref_sn: string; station_code: string; status: string;
  handled_by: string; handled_at: string; created_at: string;
}

export function AlertView({ locale }: { locale: Locale }) {
  const [tab, setTab] = useState<"active" | "all" | "rules">("active");
  const [active, setActive] = useState<AlertRow[]>([]);
  const [all, setAll] = useState<AlertRow[]>([]);
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    rule_key: "", rule_name: "", source: "", cond: "", value: "0",
    unit: "", level: "", action: "", enabled: "1", remark: "",
  });

  const load = useCallback(async () => {
    const [a, ea] = await call(() => mesrjApi.get<AlertRow[]>("/alert/active"));
    if (ea) setErr(ea); else setActive(a || []);
    const [b, eb] = await call(() => mesrjApi.get<AlertRow[]>("/alert/list"));
    if (eb) setErr(eb); else setAll(b || []);
    const [c, ec] = await call(() => mesrjApi.get<AlertRule[]>("/alert/rules"));
    if (ec) setErr(ec); else setRules(c || []);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const handle = async (r: AlertRow) => {
    setBusy(true); setErr(""); setMsg("");
    const [d, e] = await call(() => mesrjMsg.post("/alert/handle", { id: r.id }));
    setBusy(false);
    if (e) { setErr(e); return; }
    setMsg(d?.msg || t("w12.alert.handled", locale));
    void load();
  };

  const saveRule = async () => {
    setBusy(true); setErr(""); setMsg("");
    const [d, e] = await call(() => mesrjMsg.post("/alert/rules", {
      ...form, value: Number(form.value) || 0, enabled: form.enabled === "1",
    }));
    setBusy(false);
    if (e) { setErr(e); return; }
    setMsg(d?.msg || t("w12.common.saved", locale));
    setForm({ rule_key: "", rule_name: "", source: "", cond: "", value: "0", unit: "", level: "", action: "", enabled: "1", remark: "" });
    void load();
  };

  const tabs: Array<{ key: typeof tab; label: string }> = [
    { key: "active", label: t("w12.alert.tab_active", locale) },
    { key: "all", label: t("w12.alert.tab_all", locale) },
    { key: "rules", label: t("w12.alert.tab_rules", locale) },
  ];

  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 10 }}>{t("menu.report.alert", locale)}</div>
      <Ok msg={msg} /><Err msg={err} />
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {tabs.map(x => (
          <button key={x.key} {...(tab === x.key ? btnPrim : btn)} onClick={() => setTab(x.key)}>{x.label}</button>
        ))}
        <button {...btn} style={{ marginLeft: "auto" }} onClick={() => void load()}>{t("common.refresh", locale)}</button>
      </div>

      {tab !== "rules" && (
        <div style={box}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              <th style={th}>{t("w12.alert.level", locale)}</th>
              <th style={th}>{t("w12.alert.title", locale)}</th>
              <th style={th}>{t("w12.alert.detail", locale)}</th>
              <th style={th}>SN</th>
              <th style={th}>{t("w12.repair.station", locale)}</th>
              <th style={th}>{t("w12.repair.status", locale)}</th>
              <th style={th}>{t("w12.common.time", locale)}</th>
              <th style={th}>{t("common.actions", locale)}</th>
            </tr></thead>
            <tbody>
              {(tab === "active" ? active : all).map(r => (
                <tr key={r.id}>
                  <td style={{ ...td, color: r.level === "严重" ? "#dc2626" : "#b45309", fontWeight: 600 }}>{r.level || "—"}</td>
                  <td style={td}>{r.title || r.rule_name || "—"}</td>
                  <td style={{ ...td, color: "#64748b" }}>{r.detail || "—"}</td>
                  <td style={td}>{r.ref_sn || "—"}</td>
                  <td style={td}>{r.station_code || "—"}</td>
                  <td style={td}>{r.status}</td>
                  <td style={tdMuted}>{(r.created_at || "").slice(0, 16).replace("T", " ")}</td>
                  <td style={td}>
                    {r.status === "待处理" && (
                      <button {...btnPrim} disabled={busy} onClick={() => void handle(r)}>
                        {t("w12.alert.handle", locale)}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!(tab === "active" ? active : all).length && (
                <tr><td colSpan={8} style={{ ...tdMuted, padding: 12 }}>{t("common.noData", locale)}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === "rules" && (
        <>
          <div style={box}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>{t("w12.alert.add_rule", locale)}</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {([
                ["rule_key", "w12.alert.rule_key"], ["rule_name", "w12.alert.rule_name"],
                ["source", "w12.alert.source"], ["cond", "w12.alert.cond"],
                ["unit", "w12.alert.unit"], ["level", "w12.alert.level"],
                ["action", "w12.alert.action"], ["remark", "w12.layout.remark"],
              ] as Array<[keyof typeof form, string]>).map(([key, label]) => (
                <input key={key} style={{ ...inp, width: 150 }} placeholder={t(label, locale)}
                  value={form[key]} onChange={ev => setForm(s => ({ ...s, [key]: ev.target.value }))} />
              ))}
              <input style={{ ...inp, width: 100 }} type="number" placeholder={t("w12.alert.value", locale)}
                value={form.value} onChange={ev => setForm(s => ({ ...s, value: ev.target.value }))} />
              <select style={inp} value={form.enabled} onChange={ev => setForm(s => ({ ...s, enabled: ev.target.value }))}>
                <option value="1">{t("common.enabled.y", locale)}</option>
                <option value="0">{t("common.enabled.n", locale)}</option>
              </select>
              <button {...btnPrim} disabled={busy} onClick={() => void saveRule()}>{t("common.save", locale)}</button>
            </div>
          </div>
          <div style={box}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>
                <th style={th}>{t("w12.alert.rule_key", locale)}</th>
                <th style={th}>{t("w12.alert.rule_name", locale)}</th>
                <th style={th}>{t("w12.alert.source", locale)}</th>
                <th style={th}>{t("w12.alert.cond", locale)}</th>
                <th style={th}>{t("w12.alert.value", locale)}</th>
                <th style={th}>{t("w12.alert.level", locale)}</th>
                <th style={th}>{t("w12.alert.action", locale)}</th>
                <th style={th}>{t("w12.repair.status", locale)}</th>
              </tr></thead>
              <tbody>
                {rules.map(r => (
                  <tr key={r.id}>
                    <td style={td}>{r.rule_key}</td>
                    <td style={td}>{r.rule_name}</td>
                    <td style={td}>{r.source || "—"}</td>
                    <td style={td}>{r.cond || "—"}</td>
                    <td style={td}>{`${r.value}${r.unit || ""}`}</td>
                    <td style={td}>{r.level || "—"}</td>
                    <td style={td}>{r.action || "—"}</td>
                    <td style={td}>{r.enabled ? t("common.enabled.y", locale) : t("common.enabled.n", locale)}</td>
                  </tr>
                ))}
                {!rules.length && <tr><td colSpan={8} style={{ ...tdMuted, padding: 12 }}>{t("common.noData", locale)}</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 12. 车间大屏（report.board）
// ════════════════════════════════════════════════════════════════════════════
interface Shopfloor {
  lines: Array<{ line_code: string; line_name?: string; plan_qty?: number; out_qty?: number; ng_qty?: number }>;
  panels: Array<{ panel_sn?: string; mo_no?: string; station_code?: string; judge?: string; created_at?: string }>;
}

export function ShopfloorBoardView({ locale }: { locale: Locale }) {
  const [data, setData] = useState<Shopfloor | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    const [d, e] = await call(() => mesrjApi.get<Shopfloor>("/board/shopfloor"));
    if (e) setErr(e); else setData(d);
  }, []);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30000);
    return () => window.clearInterval(timer);
  }, [load]);

  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 10 }}>{t("menu.report.board", locale)}</div>
      <Err msg={err} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12, marginBottom: 14 }}>
        {(data?.lines || []).map(l => (
          <div key={l.line_code} style={{ ...box, marginBottom: 0 }}>
            <div style={{ fontSize: 13, color: "#64748b" }}>{l.line_name || l.line_code}</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: "#2563eb" }}>{l.out_qty ?? 0}</div>
            <div style={{ fontSize: 12, color: "#64748b" }}>
              {`${t("w12.board.plan", locale)} ${l.plan_qty ?? 0} · ${t("w12.board.ng", locale)} ${l.ng_qty ?? 0}`}
            </div>
          </div>
        ))}
        {!(data?.lines || []).length && <div style={{ fontSize: 13, color: "#64748b" }}>{t("w12.board.empty", locale)}</div>}
      </div>
      <div style={box}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>{t("w12.board.panels", locale)}</div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>
            <th style={th}>{t("w12.panel.panel_sn", locale)}</th>
            <th style={th}>{t("w12.common.mo_no", locale)}</th>
            <th style={th}>{t("w12.repair.station", locale)}</th>
            <th style={th}>{t("w12.panel.judge", locale)}</th>
            <th style={th}>{t("w12.common.time", locale)}</th>
          </tr></thead>
          <tbody>
            {(data?.panels || []).map((p, i) => (
              <tr key={i}>
                <td style={td}>{p.panel_sn || "—"}</td>
                <td style={td}>{p.mo_no || "—"}</td>
                <td style={td}>{p.station_code || "—"}</td>
                <td style={td}>{p.judge || "—"}</td>
                <td style={tdMuted}>{(p.created_at || "").slice(0, 16).replace("T", " ")}</td>
              </tr>
            ))}
            {!(data?.panels || []).length && <tr><td colSpan={5} style={{ ...tdMuted, padding: 12 }}>{t("common.noData", locale)}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 13. PO 全数据导出（qlt.poexport）—— PO/SN 追溯汇总 + Excel 导出
// ════════════════════════════════════════════════════════════════════════════
interface TraceSummary {
  po?: string; mo_no?: string; product_code?: string;
  [key: string]: unknown;
}

export function PoExportView({ locale }: { locale: Locale }) {
  const [po, setPo] = useState("");
  const [sn, setSn] = useState("");
  const [code, setCode] = useState("");
  const [poData, setPoData] = useState<TraceSummary | null>(null);
  const [snData, setSnData] = useState<TraceSummary | null>(null);
  const [queryData, setQueryData] = useState<Record<string, unknown> | null>(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const loadPo = async () => {
    if (!po.trim()) return;
    setBusy(true); setErr(""); setMsg("");
    const [d, e] = await call(() => mesrjApi.get<TraceSummary>("/trace/po/summary", { po: po.trim() }));
    setBusy(false);
    if (e) { setErr(e); return; }
    setPoData(d);
  };

  const loadSn = async () => {
    if (!sn.trim()) return;
    setBusy(true); setErr(""); setMsg("");
    const [d, e] = await call(() => mesrjApi.get<TraceSummary>("/trace/sn/summary", { sn: sn.trim() }));
    setBusy(false);
    if (e) { setErr(e); return; }
    setSnData(d);
  };

  const queryCode = async () => {
    if (!code.trim()) return;
    setBusy(true); setErr(""); setMsg("");
    const [d, e] = await call(() => mesrjApi.get<Record<string, unknown>>("/trace/sn/query", { code: code.trim() }));
    setBusy(false);
    if (e) { setErr(e); return; }
    setQueryData(d);
  };

  const exportPo = async () => {
    if (!po.trim()) return;
    setBusy(true); setErr(""); setMsg("");
    try {
      const token = (await import("../api/client")).authStorage.getToken();
      const res = await fetch(`${(await import("../api/client")).API_BASE}/api/mesrj/trace/po/export?po=${encodeURIComponent(po.trim())}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `trace_${po.trim()}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      setMsg(t("w12.poexport.exported", locale));
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setBusy(false);
    }
  };

  const cleanPo = async () => {
    if (!po.trim()) return;
    if (!window.confirm(t("w12.poexport.clean_confirm", locale))) return;
    setBusy(true); setErr(""); setMsg("");
    const [d, e] = await call(() => mesrjMsg.post("/trace/po/clean", { po: po.trim() }));
    setBusy(false);
    if (e) { setErr(e); return; }
    setMsg(d?.msg || t("w12.poexport.cleaned", locale));
  };

  const renderSummary = (data: TraceSummary | null) => {
    if (!data) return null;
    const entries = Object.entries(data);
    return (
      <div style={{ ...box, fontSize: 13 }}>
        {entries.map(([k, v]) => (
          <div key={k} style={{ marginBottom: 4 }}>
            <span style={{ color: "#64748b", marginRight: 6 }}>{k}:</span>
            <b style={{ whiteSpace: "pre-wrap" }}>{typeof v === "object" ? JSON.stringify(v) : String(v ?? "—")}</b>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 10 }}>{t("menu.qlt.poexport", locale)}</div>
      <Ok msg={msg} /><Err msg={err} />

      <div style={{ ...box }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>{t("w12.poexport.po_title", locale)}</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input style={{ ...inp, width: 220 }} placeholder={t("w12.common.po_no", locale)}
            value={po} onChange={ev => setPo(ev.target.value)}
            onKeyDown={ev => { if (ev.key === "Enter") void loadPo(); }} />
          <button {...btnPrim} disabled={busy || !po.trim()} onClick={() => void loadPo()}>
            {t("w12.poexport.summary", locale)}
          </button>
          <button {...btn} disabled={busy || !po.trim()} onClick={() => void exportPo()}>
            {t("w12.poexport.export", locale)}
          </button>
          <button {...btnDanger} disabled={busy || !po.trim()} onClick={() => void cleanPo()}>
            {t("w12.poexport.clean", locale)}
          </button>
        </div>
        {renderSummary(poData)}
      </div>

      <div style={{ ...box }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>{t("w12.poexport.sn_title", locale)}</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input style={{ ...inp, width: 220 }} placeholder={t("w12.desk.sn_ph", locale)}
            value={sn} onChange={ev => setSn(ev.target.value)}
            onKeyDown={ev => { if (ev.key === "Enter") void loadSn(); }} />
          <button {...btnPrim} disabled={busy || !sn.trim()} onClick={() => void loadSn()}>
            {t("w12.poexport.summary", locale)}
          </button>
        </div>
        {renderSummary(snData)}
      </div>

      <div style={{ ...box }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>{t("w12.poexport.query_title", locale)}</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input style={{ ...inp, width: 220 }} placeholder={t("w12.poexport.code_ph", locale)}
            value={code} onChange={ev => setCode(ev.target.value)}
            onKeyDown={ev => { if (ev.key === "Enter") void queryCode(); }} />
          <button {...btnPrim} disabled={busy || !code.trim()} onClick={() => void queryCode()}>
            {t("common.search", locale)}
          </button>
        </div>
        {queryData && (
          <pre style={{ margin: "10px 0 0", fontSize: 12, color: "#334155", whiteSpace: "pre-wrap" }}>
            {JSON.stringify(queryData, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}
