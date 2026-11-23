// ============================================================================
// MES-ruijing W20 前端 —— OQC 出货抽检 + OQC 逐项检验录入（源 qlt.oqc / qlt.oqccheck）
//   qlt.oqc      栈板封板后随机抽箱 → 录箱结果 → 自动判定 → 不合格走评审（返工/特采/报废）
//                返工完成重新抽检；合格后入库；PO 级放行 / 批量入库面板
//   qlt.oqccheck 按 PO 出客户报告逐项检验清单（cfg_oqc_item），录检验数量/不良数/备注，整批保存
// 后端全部走 mesrj 既有路由（/oqc/order|open_order|check_box|judge|rework_done|stock_in|
// review|scan|aql/apply_plan|aql/judge|pending_queue|po|can_ship|refresh_po|stock-in/batch、
// /oqc/check/items|ctx|save|defaults、/oqc/aql/std），不新增路由。标准见 views-w19.tsx 同套约定。
// ============================================================================
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { mesrjApi, mesrjMsg } from "./api";
import { t } from "./i18n";

const box = { border: "1px solid var(--border, #e2e8f0)", borderRadius: 10, padding: 14, marginBottom: 14 } as const;
const inp = { padding: "6px 8px", marginRight: 6 } as const;
const th = { padding: "6px 8px", borderBottom: "1px solid var(--border, #e2e8f0)", textAlign: "left" as const, whiteSpace: "nowrap" as const };
const td = { padding: "5px 8px", borderBottom: "1px solid #f1f5f9", fontSize: 12 };

function Err({ msg }: { msg: string }) {
  if (!msg) return null;
  return <div style={{ color: "#b91c1c", padding: "6px 0", fontSize: 13, whiteSpace: "pre-wrap" }}>{msg}</div>;
}
function Ok({ msg }: { msg: string }) {
  if (!msg) return null;
  return <div style={{ color: "#15803d", padding: "6px 0", fontSize: 13 }}>{msg}</div>;
}
const errText = (ex: unknown) => (ex instanceof Error ? ex.message : String(ex));

/** 状态值来自后端（中文枚举），只做着色，不翻译 */
function St({ v }: { v: string }) {
  const color: Record<string, string> = {
    合格: "#0f6e56", PASS: "#0f6e56", 全部合格: "#0f6e56", 已入库: "#1d4ed8",
    不合格: "#b42318", FAIL: "#b42318", 检验中: "#b45309", 部分合格: "#b45309", 已返工: "#b45309",
  };
  return <b style={{ color: color[v] || "#334155" }}>{v || "-"}</b>;
}
function KV({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11.5, color: "#94a3b8" }}>{k}</div>
      <div style={{ fontSize: 13 }}>{v}</div>
    </div>
  );
}

// ── 数据结构（对应 oqc-core.js orderJson / prd_pallet / poSummary / check items）──
interface OqcItemRow { box_no: string; box_qty?: number; sample_qty?: number; result?: string; defect_code?: string; defect_desc?: string; inspector?: string; checked_at?: string }
interface OqcOrder {
  oqc_no: string; pallet_no: string; po_no?: string; mo_no?: string; product_code?: string;
  pallet_qty?: number; box_total?: number; sample_n?: number; sample_boxes?: string;
  ok_boxes?: string; ng_boxes?: string; result?: string; status?: string; round_no?: number;
  inspector?: string; inspect_time?: string;
  lot_qty?: number; aql_level?: string; aql_severity?: string; aql_ma?: number; aql_mi?: number;
  code_letter?: string; sample_n_aql?: number; ac_ma?: number; ac_mi?: number;
  defect_cr?: number; defect_ma?: number; defect_mi?: number; aql_result?: string; aql_note?: string;
  review_decision?: string; review_by?: string; review_time?: string; review_reason?: string;
  rework_start_time?: string; rework_start_by?: string; notify_state?: string;
  items?: OqcItemRow[]; pending?: number; checked?: number;
}
interface OqcPallet {
  pallet_no: string; po_no?: string; mo_no?: string; cust_code?: string; product_code?: string;
  box_count?: number; total_qty?: number; status?: string; oqc_status?: string; oqc_time?: string;
  release_locked?: number | boolean; stock_in_status?: string; stock_in_time?: string;
}
interface QueueRow { pallet_no: string; po_no?: string; product_code?: string; box_count?: number; total_qty?: number; oqc_status?: string; stock_in_status?: string; wait_hours?: number }
interface PoGap { order_qty?: number; ready?: number; wip?: number; gap?: number }
interface PoData {
  po_no: string; cust_code?: string; pallets?: number; passed?: number; failed?: number;
  stocked?: number; qty?: number; can_ship?: boolean; oqc_status?: string;
  ship_allowed?: boolean; ship_block_reason?: string; gap_info?: PoGap;
  rows?: Array<{ pallet_no: string; box_count?: number; total_qty?: number; oqc_status?: string; stock_in_status?: string; oqc_time?: string }>;
}
interface AqlStd { [k: string]: string }

// ════════════════════════════════ qlt.oqc 出货抽检 ════════════════════════════════
export function OqcInspectView({ locale }: { locale: Locale }) {
  const [pallet, setPallet] = useState("");
  const [order, setOrder] = useState<OqcOrder | null>(null);
  const [pl, setPl] = useState<OqcPallet | null>(null);
  const [queue, setQueue] = useState<QueueRow[] | null>(null);
  const [std, setStd] = useState<AqlStd>({});
  const [ngDesc, setNgDesc] = useState<Record<string, string>>({});
  const [reviewReason, setReviewReason] = useState("");
  const [rwSn, setRwSn] = useState("");
  const [poNo, setPoNo] = useState("");
  const [po, setPo] = useState<PoData | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(""); const [msg, setMsg] = useState("");

  const loadPallet = useCallback(async (no: string) => {
    setErr(""); setQueue(null);
    try {
      const d = await mesrjApi.get<{ order: OqcOrder | null; pallet: OqcPallet | null }>("/oqc/order", { pallet_no: no });
      setOrder(d?.order ?? null); setPl(d?.pallet ?? null); setNgDesc({}); setReviewReason(""); setRwSn("");
    } catch (ex) { setErr(errText(ex)); setOrder(null); setPl(null); }
  }, []);
  useEffect(() => {
    void mesrjApi.get<AqlStd>("/oqc/aql/std").then(d => setStd(d || {})).catch(() => setStd({}));
  }, []);

  const act = useCallback(async (fn: () => Promise<void>) => {
    setErr(""); setMsg(""); setBusy(true);
    try { await fn(); } catch (ex) { setErr(errText(ex)); } finally { setBusy(false); }
  }, []);

  const openOrder = () => void act(async () => {
    const v = pallet.trim();
    if (!v) { setErr(t("w20.oqc.scanFirst", locale)); return; }
    const r = await mesrjMsg.post<OqcOrder>("/oqc/open_order", { pallet_no: v });
    setMsg(r.msg || "");
    await loadPallet(v);
  });

  const loadQueue = () => void act(async () => {
    setQueue(await mesrjApi.get<QueueRow[]>("/oqc/pending_queue"));
  });

  const checkBox = (boxNo: string, result: "OK" | "NG") => void act(async () => {
    if (!order) return;
    const r = await mesrjMsg.post<OqcOrder>("/oqc/check_box", {
      oqc_no: order.oqc_no, box_no: boxNo, result, defect_desc: result === "NG" ? (ngDesc[boxNo] || "") : "",
    });
    setMsg(r.msg || "");
    if (r.data) setOrder(r.data);
    await loadPallet(order.pallet_no);
  });

  const applyPlan = () => void act(async () => {
    if (!order) return;
    const r = await mesrjMsg.post("/oqc/aql/apply_plan", { oqc_no: order.oqc_no });
    setMsg(r.msg || ""); await loadPallet(order.pallet_no);
  });
  const aqlJudge = () => void act(async () => {
    if (!order) return;
    const r = await mesrjMsg.post("/oqc/aql/judge", { oqc_no: order.oqc_no });
    setMsg(r.msg || ""); await loadPallet(order.pallet_no);
  });
  const review = (decision: string) => void act(async () => {
    if (!order) return;
    const r = await mesrjMsg.post("/oqc/review", { oqc_no: order.oqc_no, decision, reason: reviewReason.trim() });
    setMsg(r.msg || ""); setReviewReason(""); await loadPallet(order.pallet_no);
  });
  const scan = () => void act(async () => {
    if (!order) return;
    const sn = rwSn.trim();
    if (!sn) { setErr(t("w20.oqc.scanSnFirst", locale)); return; }
    const r = await mesrjMsg.post("/oqc/scan", { oqc_no: order.oqc_no, sn, result: "OK" });
    setMsg(r.msg || ""); setRwSn("");
  });
  const reworkDone = () => void act(async () => {
    if (!order) return;
    const r = await mesrjMsg.post("/oqc/rework_done", { oqc_no: order.oqc_no });
    setMsg(r.msg || ""); await loadPallet(order.pallet_no);
  });
  const stockIn = (no: string) => void act(async () => {
    const r = await mesrjMsg.post("/oqc/stock_in", { pallet_no: no });
    setMsg(r.msg || ""); await loadPallet(no);
  });

  const findPo = () => void act(async () => {
    const v = poNo.trim();
    if (!v) { setErr(t("w20.oqc.poFirst", locale)); return; }
    setPo(await mesrjApi.get<PoData>("/oqc/po", { po_no: v }));
  });
  const batchIn = () => void act(async () => {
    if (!po) return;
    if (!window.confirm(t("w20.oqc.batchConfirm", locale))) return;
    const r = await mesrjMsg.post<{ done?: string[]; blocked?: Array<{ pallet_no: string; reason: string }> }>("/oqc/stock-in/batch", { po_no: po.po_no });
    setMsg(r.msg || "");
    const d = await mesrjApi.get<PoData>("/oqc/po", { po_no: po.po_no }); setPo(d);
  });
  const shipCheck = () => void act(async () => {
    if (!po) return;
    const d = await mesrjApi.get<{ can_ship: boolean; reason: string }>("/oqc/can_ship", { po_no: po.po_no });
    if (d?.can_ship) setMsg(t("w20.oqc.shipOk", locale)); else setErr(`${t("w20.oqc.shipBlock", locale)}：${d?.reason || ""}`);
  });
  const refreshPo = () => void act(async () => {
    if (!po) return;
    const r = await mesrjMsg.post("/oqc/refresh_po", { po_no: po.po_no });
    setMsg(r.msg || "");
    const d = await mesrjApi.get<PoData>("/oqc/po", { po_no: po.po_no }); setPo(d);
  });

  const decided = order ? order.result === "合格" || order.result === "不合格" : false;
  const gi = po?.gap_info;

  return (
    <div>
      {/* 工具条 */}
      <div style={{ ...box, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <b style={{ fontSize: 14 }}>{t("menu.qlt.oqc", locale)}</b>
        <input value={pallet} onChange={e => setPallet(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") openOrder(); }}
          placeholder={t("w20.oqc.palletPh", locale)} style={{ ...inp, width: 260 }} />
        <button disabled={busy} onClick={openOrder}>{t("w20.oqc.open", locale)}</button>
        <button disabled={busy} onClick={loadQueue}>{t("w20.oqc.pendingBtn", locale)}</button>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: "#94a3b8" }}>{t("w20.oqc.hint", locale)}</span>
      </div>
      {std["oqc.aql_level"] && (
        <div style={{ ...box, padding: "8px 14px", fontSize: 12, color: "#334155" }}>
          {t("w20.oqc.stdBar", locale)}：{t("w19.aql.level", locale)} <b>{std["oqc.aql_level"]}</b>
          {" · "}{t("w19.aql.severity", locale)} <b>{std["oqc.aql_severity"]}</b>
          {" · "}{t("w19.aql.ma", locale)} <b>{std["oqc.aql_ma"]}</b> · {t("w19.aql.mi", locale)} <b>{std["oqc.aql_mi"]}</b>
          {" · "}{t("w19.aql.basis", locale)} <b>{std["oqc.aql_lot_basis"]}</b>
        </div>
      )}
      <Err msg={err} /><Ok msg={msg} />

      {/* 待检池 */}
      {queue && (
        <div style={box}>
          <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 13 }}>{t("w20.oqc.queueTitle", locale)}</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead><tr>
              <th style={th}>{t("w20.oqc.palletNo", locale)}</th><th style={th}>PO</th>
              <th style={th}>{t("w20.oqc.boxCount", locale)}</th><th style={th}>{t("qty", locale)}</th>
              <th style={th}>OQC</th><th style={th}>{t("w20.oqc.waitHours", locale)}</th><th style={th} />
            </tr></thead>
            <tbody>
              {queue.length === 0 && <tr><td colSpan={7} style={{ ...td, color: "#94a3b8" }}>{t("w20.oqc.queueEmpty", locale)}</td></tr>}
              {queue.map(r => (
                <tr key={r.pallet_no}>
                  <td style={{ ...td, fontFamily: "monospace" }}>{r.pallet_no}</td>
                  <td style={td}>{r.po_no || "-"}</td>
                  <td style={td}>{r.box_count ?? 0}</td>
                  <td style={td}>{r.total_qty ?? 0}</td>
                  <td style={td}><St v={r.oqc_status || ""} /></td>
                  <td style={td}>{r.wait_hours ?? "-"}</td>
                  <td style={td}>
                    <button onClick={() => { setPallet(r.pallet_no); void loadPallet(r.pallet_no); }}>{t("w20.oqc.pick", locale)}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 栈板卡 */}
      {pl && (
        <div style={{ ...box, display: "flex", gap: 24, flexWrap: "wrap" }}>
          <KV k={t("w20.oqc.palletNo", locale)} v={<span style={{ fontFamily: "monospace", fontWeight: 600 }}>{pl.pallet_no}</span>} />
          <KV k={t("w20.oqc.poMo", locale)} v={`${pl.po_no || "-"} / ${pl.mo_no || "-"}`} />
          <KV k={t("w20.oqc.boxQtyUnit", locale)} v={`${pl.box_count ?? 0} / ${pl.total_qty ?? 0}`} />
          <KV k="OQC" v={<St v={pl.oqc_status || ""} />} />
          <KV k={t("w20.oqc.lock", locale)} v={pl.release_locked ? <b style={{ color: "#b42318" }}>{t("w20.oqc.locked", locale)}</b> : <b style={{ color: "#0f6e56" }}>{t("w20.oqc.released", locale)}</b>} />
          <KV k={t("w20.oqc.stockStatus", locale)} v={pl.stock_in_status || t("w20.oqc.notStocked", locale)} />
        </div>
      )}

      {/* 抽检单 */}
      {order ? (
        <div style={box}>
          <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 13 }}>
            {t("w20.oqc.orderTitle", locale)} <span style={{ fontFamily: "monospace" }}>{order.oqc_no}</span>
            <span style={{ color: "#64748b", fontWeight: 400, marginLeft: 10, fontSize: 12 }}>
              {t("w20.oqc.round", locale)} {order.round_no ?? 1} · {t("w20.oqc.sampled", locale)} {order.sample_n ?? 0}/{order.box_total ?? 0} · {t("w20.oqc.result", locale)} <St v={order.result || ""} />
            </span>
          </div>
          <div style={{ fontSize: 12, color: "#64748b", marginBottom: 8, fontFamily: "monospace" }}>
            {t("w20.oqc.sampleBoxes", locale)}：{order.sample_boxes || "-"}
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead><tr>
              <th style={th}>{t("w20.oqc.colBox", locale)}</th><th style={th}>{t("w20.oqc.colBoxQty", locale)}</th>
              <th style={th}>{t("w20.oqc.colResult", locale)}</th><th style={th}>{t("w20.oqc.colDefect", locale)}</th>
              <th style={th}>{t("w20.oqc.colAct", locale)}</th>
            </tr></thead>
            <tbody>
              {(order.items || []).map(it => (
                <tr key={it.box_no}>
                  <td style={{ ...td, fontFamily: "monospace" }}>{it.box_no}</td>
                  <td style={td}>{it.box_qty ?? 0}</td>
                  <td style={td}><St v={it.result || t("w20.oqc.toCheck", locale)} /></td>
                  <td style={{ ...td, color: "#64748b" }}>
                    {it.defect_desc || it.defect_code || (decided ? "" : (
                      <input value={ngDesc[it.box_no] || ""} onChange={e => setNgDesc(x => ({ ...x, [it.box_no]: e.target.value }))}
                        placeholder={t("w20.oqc.defectPh", locale)} style={{ width: "100%", boxSizing: "border-box", padding: "3px 6px", fontSize: 12 }} />
                    ))}
                  </td>
                  <td style={td}>
                    {!decided && (
                      <>
                        <button disabled={busy} onClick={() => checkBox(it.box_no, "OK")}>OK</button>{" "}
                        <button disabled={busy} onClick={() => checkBox(it.box_no, "NG")}>NG</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!decided && (order.pending ?? 0) > 0 && (
            <div style={{ marginTop: 8, fontSize: 12, color: "#64748b" }}>{t("w20.oqc.pendingLeft", locale)} <b>{order.pending}</b> {t("w20.oqc.pendingLeft2", locale)}</div>
          )}

          {/* AQL 抽样面板（缺陷数以设备/单上记录为准，页面不再造录入接口） */}
          <div style={{ marginTop: 10, padding: "10px 12px", background: "#f8fafc", border: "1px solid #e7ecf3", borderRadius: 8, fontSize: 12 }}>
            <b>{t("w20.oqc.aqlTitle", locale)}</b>
            {(order.sample_n_aql ?? 0) > 0 ? (
              <span style={{ marginLeft: 10 }}>
                {t("w20.oqc.lot", locale)} <b>{order.lot_qty ?? 0}</b> · {t("w19.aql.level", locale)} <b>{order.aql_level || "II"}</b> ·
                {t("w20.oqc.codeLetter", locale)} <b>{order.code_letter || "-"}</b> · {t("w20.oqc.sampleN", locale)} <b>{order.sample_n_aql}</b> ·
                MA Ac{order.ac_ma ?? "-"} / MI Ac{order.ac_mi ?? "-"} · CR Ac0 ·
                {t("w20.oqc.defects", locale)} {order.defect_cr ?? 0}/{order.defect_ma ?? 0}/{order.defect_mi ?? 0}
                {order.aql_result && <b style={{ color: order.aql_result === "合格" ? "#0f6e56" : "#b42318", marginLeft: 8 }}>　{order.aql_result} {order.aql_note || ""}</b>}
              </span>
            ) : (
              <span style={{ marginLeft: 10, color: "#64748b" }}>{t("w20.oqc.noPlan", locale)}</span>
            )}
            <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button disabled={busy} onClick={applyPlan}>{t("w20.oqc.applyPlan", locale)}</button>
              {(order.sample_n_aql ?? 0) > 0 && <button disabled={busy} onClick={aqlJudge}>{t("w20.oqc.aqlJudge", locale)}</button>}
            </div>
          </div>

          {/* 判定尾巴：合格 / 不合格评审 / 返工 */}
          {order.result === "合格" && (
            <div style={{ marginTop: 10, fontSize: 12.5, color: "#0f6e56" }}>
              <b>{t("w20.oqc.passMsg", locale)}</b>
              <div style={{ marginTop: 6 }}>
                {pl?.stock_in_status === "已入库"
                  ? <span style={{ color: "#64748b" }}>{t("w20.oqc.stockedAt", locale)} {pl?.stock_in_time || pl?.oqc_time || ""}</span>
                  : <button disabled={busy} onClick={() => stockIn(order.pallet_no)}>{t("w20.oqc.stockIn", locale)}</button>}
              </div>
            </div>
          )}
          {order.result === "不合格" && (
            <div style={{ marginTop: 10, fontSize: 12.5 }}>
              <div style={{ color: "#b42318" }}><b>{t("w20.oqc.failMsg", locale)}</b>{order.ng_boxes ? `：${order.ng_boxes}` : ""}　{t("w20.oqc.stockLocked", locale)}</div>
              {!order.review_decision || order.review_decision === "待评审" ? (
                <div style={{ marginTop: 8, padding: "10px 12px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8 }}>
                  <div style={{ color: "#991b1b", marginBottom: 6 }}>{t("w20.oqc.reviewTitle", locale)}</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <input value={reviewReason} onChange={e => setReviewReason(e.target.value)}
                      placeholder={t("w20.oqc.reviewReasonPh", locale)} style={{ ...inp, width: 240 }} />
                    <button disabled={busy} onClick={() => review("返工")}>{t("w20.oqc.decRework", locale)}</button>
                    <button disabled={busy} onClick={() => review("特采")}>{t("w20.oqc.decWaiver", locale)}</button>
                    <button disabled={busy} onClick={() => review("报废")}>{t("w20.oqc.decScrap", locale)}</button>
                  </div>
                </div>
              ) : order.review_decision === "返工" ? (
                <div style={{ marginTop: 8, padding: "10px 12px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8 }}>
                  <div style={{ color: "#92400e", marginBottom: 6 }}>
                    <b>{t("w20.oqc.decRework", locale)}</b>（{order.review_by || ""} {order.review_time || ""}）
                    {order.rework_start_time ? ` · ${t("w20.oqc.reworkStarted", locale)}：${order.rework_start_time} / ${order.rework_start_by || ""}` : ""}
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <input value={rwSn} onChange={e => setRwSn(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") scan(); }}
                      placeholder={t("w20.oqc.rwSnPh", locale)} style={{ ...inp, width: 240 }} />
                    <button disabled={busy} onClick={scan}>{t("w20.oqc.rwScan", locale)}</button>
                    <button disabled={busy} onClick={reworkDone}>{t("w20.oqc.rwDone", locale)}</button>
                  </div>
                </div>
              ) : order.review_decision === "特采" ? (
                <div style={{ marginTop: 8, padding: "10px 12px", background: "#ecfdf5", border: "1px solid #a7f3d0", borderRadius: 8, color: "#065f46" }}>
                  <b>{t("w20.oqc.waived", locale)}</b>（{order.review_by || ""} {order.review_time || ""}）　{t("w20.oqc.reason", locale)}：{order.review_reason || "-"}
                </div>
              ) : (
                <div style={{ marginTop: 8, padding: "10px 12px", background: "#f1f5f9", border: "1px solid #cbd5e1", borderRadius: 8, color: "#334155" }}>
                  <b>{t("w20.oqc.scrapped", locale)}</b>（{order.review_by || ""}）
                </div>
              )}
            </div>
          )}
        </div>
      ) : pl ? (
        <div style={box}>
          <div style={{ fontSize: 13, color: "#64748b" }}>{t("w20.oqc.noOrder", locale)}</div>
          <div style={{ fontSize: 14, marginTop: 6 }}><b style={{ fontFamily: "monospace" }}>{pl.pallet_no}</b></div>
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>{t("w20.oqc.boxQtyUnit", locale)}：{pl.box_count ?? 0} / {pl.total_qty ?? 0} · OQC <St v={pl.oqc_status || ""} /></div>
          <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 8 }}>{t("w20.oqc.openFlowHint", locale)}</div>
        </div>
      ) : null}

      {/* PO 级放行 / 批量入库 */}
      <div style={box}>
        <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 13 }}>{t("w20.oqc.poCardTitle", locale)}</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input value={poNo} onChange={e => setPoNo(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") findPo(); }}
            placeholder={t("w20.oqc.poPh", locale)} style={{ ...inp, width: 220 }} />
          <button disabled={busy} onClick={findPo}>{t("search", locale)}</button>
        </div>
        {po && (
          <div style={{ marginTop: 12 }}>
            <div style={{ display: "flex", gap: 22, flexWrap: "wrap", marginBottom: 10 }}>
              <KV k="PO" v={<span style={{ fontFamily: "monospace", fontWeight: 600 }}>{po.po_no}</span>} />
              <KV k={t("w20.oqc.cust", locale)} v={po.cust_code || "-"} />
              <KV k={t("w20.oqc.pallets", locale)} v={po.pallets ?? 0} />
              <KV k={t("w20.oqc.passFail", locale)} v={<><span style={{ color: "#0f6e56" }}>{po.passed ?? 0}</span> / <span style={{ color: "#b42318" }}>{po.failed ?? 0}</span></>} />
              <KV k={t("w20.oqc.stocked", locale)} v={po.stocked ?? 0} />
              <KV k={t("w20.oqc.totalQty", locale)} v={po.qty ?? 0} />
              {gi?.order_qty ? <>
                <KV k={t("w20.oqc.orderQty", locale)} v={gi.order_qty ?? 0} />
                <KV k={t("w20.oqc.ready", locale)} v={<b style={{ color: "#0f6e56" }}>{gi.ready ?? 0}</b>} />
                <KV k={t("w20.oqc.wip", locale)} v={gi.wip ?? 0} />
                <KV k={t("w20.oqc.gap", locale)} v={<b style={{ color: gi.gap ? "#b45309" : "#0f6e56" }}>{gi.gap ?? 0}</b>} />
              </> : null}
              <KV k={t("w20.oqc.poRelease", locale)} v={<St v={po.oqc_status || ""} />} />
              <KV k={t("w20.oqc.shipable", locale)} v={po.ship_allowed ? <b style={{ color: "#0f6e56" }}>{t("w20.oqc.shipYes", locale)}</b> : <b style={{ color: "#b42318" }}>{t("w20.oqc.shipNo", locale)}</b>} />
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead><tr>
                <th style={th}>{t("w20.oqc.palletNo", locale)}</th><th style={th}>{t("w20.oqc.boxCount", locale)}</th>
                <th style={th}>{t("qty", locale)}</th><th style={th}>OQC</th><th style={th}>{t("w20.oqc.stockStatus", locale)}</th><th style={th}>{t("w12.common.time", locale)}</th>
              </tr></thead>
              <tbody>
                {(po.rows || []).length === 0 && <tr><td colSpan={6} style={{ ...td, color: "#94a3b8" }}>{t("w20.oqc.poEmpty", locale)}</td></tr>}
                {(po.rows || []).map(r => (
                  <tr key={r.pallet_no}>
                    <td style={{ ...td, fontFamily: "monospace" }}>{r.pallet_no}</td>
                    <td style={td}>{r.box_count ?? 0}</td><td style={td}>{r.total_qty ?? 0}</td>
                    <td style={td}><St v={r.oqc_status || ""} /></td>
                    <td style={td}>{r.stock_in_status || t("w20.oqc.notStocked", locale)}</td>
                    <td style={{ ...td, color: "#94a3b8", fontFamily: "monospace" }}>{r.oqc_time || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!po.ship_allowed && <div style={{ marginTop: 8, color: "#b42318", fontSize: 12.5 }}>{t("w20.oqc.shipBlock", locale)}：{po.ship_block_reason || "-"}</div>}
            <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button disabled={busy} onClick={batchIn}>{t("w20.oqc.batchIn", locale)}</button>
              <button disabled={busy} onClick={shipCheck}>{t("w20.oqc.shipCheck", locale)}</button>
              <button disabled={busy} onClick={refreshPo}>{t("w20.oqc.refreshPo", locale)}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════ qlt.oqccheck 逐项检验录入 ════════════════════════
interface ChkRow {
  seq: number; cat?: string; item_name?: string; spec?: string;
  insp_qty?: number; ng_qty?: number; ok_qty?: number;
  equip?: string; remark?: string; inspector?: string; check_time?: string; saved?: boolean;
}
export function OqcCheckEntryView({ locale }: { locale: Locale }) {
  const [poNo, setPoNo] = useState("");
  const [model, setModel] = useState("");
  const [rows, setRows] = useState<ChkRow[] | null>(null);
  const [loadedPo, setLoadedPo] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(""); const [msg, setMsg] = useState("");

  const load = useCallback(async (v: string) => {
    setErr(""); setMsg(""); setBusy(true);
    try {
      const d = await mesrjApi.get<{ poNo: string; model: string; items: ChkRow[] }>("/oqc/check/ctx", { po_no: v });
      setRows(d?.items || []); setModel(d?.model || ""); setLoadedPo(v);
    } catch (ex) { setErr(errText(ex)); setRows(null); } finally { setBusy(false); }
  }, []);
  const patch = (seq: number, fields: Partial<ChkRow>) => {
    setRows(rs => (rs || []).map(r => {
      if (r.seq !== seq) return r;
      const n = { ...r, ...fields };
      n.ok_qty = Math.max(Number(n.insp_qty || 0) - Number(n.ng_qty || 0), 0);
      return n;
    }));
  };

  const save = () => void (async () => {
    if (!rows || !loadedPo) return;
    setErr(""); setMsg(""); setBusy(true);
    try {
      const r = await mesrjMsg.post<{ poNo?: string; saved?: number; error?: string }>("/oqc/check/save", {
        po_no: loadedPo,
        items: rows.map(x => ({
          seq: x.seq, cat: x.cat || "", item_name: x.item_name || "", spec: x.spec || "",
          insp_qty: Number(x.insp_qty || 0), ng_qty: Number(x.ng_qty || 0),
          equip: x.equip || "", remark: x.remark || "",
        })),
      });
      if (r.data?.error) setErr(r.data.error);
      else { setMsg(`${r.msg || ""}（${r.data?.saved ?? 0} ${t("w20.chk.itemsUnit", locale)}）`); void load(loadedPo); }
    } catch (ex) { setErr(errText(ex)); } finally { setBusy(false); }
  })();

  const resetDefaults = () => void (async () => {
    if (!rows) return;
    setErr(""); setMsg(""); setBusy(true);
    try {
      const d = await mesrjApi.get<{ defaults: Array<[number, string, string, string, number, string]> }>("/oqc/check/defaults");
      const def: Record<number, number> = {};
      for (const a of d?.defaults || []) def[a[0]] = Number(a[4] || 0);
      setRows(rs => (rs || []).map(r => ({ ...r, insp_qty: def[r.seq] ?? r.insp_qty ?? 0, ng_qty: 0, ok_qty: def[r.seq] ?? r.insp_qty ?? 0 })));
      setMsg(t("w20.chk.resetLocal", locale));
    } catch (ex) { setErr(errText(ex)); } finally { setBusy(false); }
  })();

  const inspTotal = (rows || []).reduce((s, r) => s + Number(r.insp_qty || 0), 0);
  const ngTotal = (rows || []).reduce((s, r) => s + Number(r.ng_qty || 0), 0);
  const numInp = (v: number | undefined, onSet: (n: number) => void, danger?: boolean) => (
    <input type="number" min={0} value={v ?? 0} onChange={e => onSet(Number(e.target.value || 0))}
      style={{ width: 70, padding: "3px 6px", textAlign: "right", fontSize: 12.5,
        border: danger ? "1px solid #fca5a5" : "1px solid var(--border, #e2e8f0)",
        background: danger ? "#fef2f2" : undefined, boxSizing: "border-box" }} />
  );

  return (
    <div>
      <div style={{ ...box, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <b style={{ fontSize: 14 }}>{t("menu.qlt.oqccheck", locale)}</b>
        <input value={poNo} onChange={e => setPoNo(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && poNo.trim()) void load(poNo.trim()); }}
          placeholder={t("w20.chk.poPh", locale)} style={{ ...inp, width: 200 }} />
        <button disabled={busy} onClick={() => { if (poNo.trim()) void load(poNo.trim()); }}>{t("search", locale)}</button>
        <button disabled={!rows?.length || busy} onClick={save}>{t("save", locale)}</button>
        <button disabled={!rows || busy} onClick={resetDefaults}>{t("w20.chk.resetDefaults", locale)}</button>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: "#94a3b8" }}>{t("w20.chk.hint", locale)}</span>
      </div>
      <Err msg={err} /><Ok msg={msg} />

      {rows && rows.length > 0 && (
        <div style={{ ...box, display: "flex", gap: 22, flexWrap: "wrap" }}>
          <KV k="PO" v={<span style={{ fontFamily: "monospace" }}>{loadedPo}</span>} />
          <KV k={t("w20.chk.model", locale)} v={model || "—"} />
          <KV k={t("w20.chk.itemsKpi", locale)} v={`${rows.length} ${t("w20.chk.itemsUnit", locale)}`} />
          <KV k={t("w20.chk.inspTotal", locale)} v={inspTotal} />
          <KV k={t("w20.chk.ngTotal", locale)} v={<span style={{ color: ngTotal ? "#b42318" : "#0f6e56" }}>{ngTotal}</span>} />
          <KV k={t("w20.chk.verdict", locale)} v={<St v={ngTotal ? t("w20.chk.fail", locale) : t("w20.chk.pass", locale)} />} />
        </div>
      )}

      {rows && (rows.length === 0 ? (
        <div style={{ ...box, color: "#64748b", fontSize: 13 }}>{t("w20.chk.noItems", locale)}</div>
      ) : (
        <div style={box}>
          <div style={{ overflow: "auto", maxHeight: "calc(100vh - 330px)" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead><tr>
                <th style={{ ...th, width: 48 }}>{t("w20.chk.colSeq", locale)}</th>
                <th style={{ ...th, width: 90 }}>{t("w20.chk.colCat", locale)}</th>
                <th style={{ ...th, minWidth: 180 }}>{t("w20.chk.colItem", locale)}</th>
                <th style={{ ...th, minWidth: 160, color: "#64748b", fontWeight: 400 }}>{t("w20.chk.colSpec", locale)}</th>
                <th style={{ ...th, width: 88, textAlign: "right" }}>{t("w20.chk.colInsp", locale)}</th>
                <th style={{ ...th, width: 80, textAlign: "right" }}>{t("w20.chk.colNg", locale)}</th>
                <th style={{ ...th, width: 70, textAlign: "right" }}>{t("w20.chk.colOk", locale)}</th>
                <th style={{ ...th, width: 70, textAlign: "right" }}>{t("w20.chk.colRate", locale)}</th>
                <th style={{ ...th, width: 100 }}>{t("w20.chk.colEquip", locale)}</th>
                <th style={{ ...th, minWidth: 110 }}>{t("w20.chk.colRemark", locale)}</th>
                <th style={{ ...th, width: 84 }}>{t("w20.chk.colInspector", locale)}</th>
              </tr></thead>
              <tbody>
                {rows.map(r => {
                  const insp = Number(r.insp_qty || 0), ng = Number(r.ng_qty || 0);
                  return (
                    <tr key={r.seq}>
                      <td style={{ ...td, fontFamily: "monospace", color: "#94a3b8" }}>{r.seq}</td>
                      <td style={td}><span style={{ fontSize: 11.5, padding: "2px 8px", borderRadius: 4, border: "1px solid #1d4ed833", color: "#1d4ed8", background: "#1d4ed80f" }}>{r.cat || "—"}</span></td>
                      <td style={{ ...td, fontWeight: 500 }}>{r.item_name}</td>
                      <td style={{ ...td, color: "#64748b", fontSize: 11.5 }} title={r.spec || ""}>{r.spec}</td>
                      <td style={{ ...td, textAlign: "right" }}>{numInp(r.insp_qty, n => patch(r.seq, { insp_qty: n }))}</td>
                      <td style={{ ...td, textAlign: "right" }}>{numInp(r.ng_qty, n => patch(r.seq, { ng_qty: n }), ng > 0)}</td>
                      <td style={{ ...td, textAlign: "right", fontFamily: "monospace" }}>{Math.max(insp - ng, 0)}</td>
                      <td style={{ ...td, textAlign: "right", fontFamily: "monospace" }}>{insp ? (ng * 100 / insp).toFixed(2) : "0.00"}</td>
                      <td style={{ ...td, color: "#64748b", fontSize: 11.5 }}>{r.equip || ""}</td>
                      <td style={td}>
                        <input value={r.remark || ""} onChange={e => patch(r.seq, { remark: e.target.value })}
                          style={{ width: "100%", minWidth: 100, padding: "3px 6px", fontSize: 12, boxSizing: "border-box" }} />
                      </td>
                      <td style={{ ...td, color: "#64748b", fontSize: 11.5 }}>{r.inspector || ""}{r.saved ? "" : " *"} </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 8, fontSize: 11.5, color: "#94a3b8" }}>{t("w20.chk.footNote", locale)}</div>
        </div>
      ))}
      {!rows && !err && (
        <div style={{ ...box, color: "#94a3b8", fontSize: 13, padding: 28, textAlign: "center" }}>{t("w20.chk.queryFirst", locale)}</div>
      )}
    </div>
  );
}
