// ============================================================================
// MES-ruijing W20 前端 —— SMT 上料防错（PDA）+ 首件确认/设备点检
// （源 ruijing-mes-ref/web/pages.js exec.loading / exec.fa）
// 后端全部走 mesrj 既有路由（实测存在）：
//   GET  /order/mo/options          在制工单下拉（生产中优先 + 最近开工倒序，含机型/计划/已做）
//   POST /smt/load_recommend        扫料盘 → 解析 + 候选站位 + 历史推荐（gap-routes.js）
//   POST /smt/load_check            上料确认/校验（源 load_confirm，写 prd_material_load）
//   POST /smt/load_change           中途换料（旧盘 → 新盘）
//   POST /smt/load_return           退料（归还库存）
//   GET  /smt/material_load         最近上料记录（/smt/load/list 在本环境返回空壳，用它）
//   GET  /smt/paste|pcb|stencil/list 辅料时效面板
//   POST /smt/fa/confirm  GET /smt/fa/status        首件确认 / 状态
//   POST /smt/equip/check GET /smt/equip/status     班次点检 / 开工前检查
//   GET  /smt/equip_check                            最近点检记录
// 说明类文案在信封/数据的 msg 里（后端中文提示，原样显示，不翻译）。
// 标准同 views-w19.tsx / views-w20-oqc.tsx。
// ============================================================================
import { useCallback, useEffect, useRef, useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { mesrjApi, mesrjMsg } from "./api";
import { t } from "./i18n";

const box = { border: "1px solid var(--border, #e2e8f0)", borderRadius: 10, padding: 14, marginBottom: 14 } as const;
const inp = { padding: "6px 8px", marginRight: 6, border: "1px solid var(--border, #e2e8f0)", borderRadius: 6 } as const;
const th = { padding: "6px 8px", borderBottom: "1px solid var(--border, #e2e8f0)", textAlign: "left" as const, whiteSpace: "nowrap" as const, fontSize: 12 };
const td = { padding: "5px 8px", borderBottom: "1px solid #f1f5f9", fontSize: 12 };
const label = { fontSize: 11.5, color: "#94a3b8", marginBottom: 3 } as const;

function Err({ msg }: { msg: string }) {
  if (!msg) return null;
  return <div style={{ color: "#b91c1c", padding: "6px 0", fontSize: 13, whiteSpace: "pre-wrap" }}>{msg}</div>;
}
const errText = (ex: unknown) => (ex instanceof Error ? ex.message : String(ex));

/** 作业结果大横幅（源 showRes：PDA 扫码校验通过绿 / 失败红） */
function Banner({ ok, text }: { ok: boolean; text: string }) {
  if (!text) return null;
  return (
    <div style={{
      padding: "14px 18px", borderRadius: 10, fontSize: 16, fontWeight: 700, color: "#fff", marginTop: 4,
      background: ok ? "linear-gradient(135deg,#059669,#10b981)" : "linear-gradient(135deg,#b91c1c,#ef4444)",
      whiteSpace: "pre-wrap",
    }}>{text}</div>
  );
}

/** 后端 state 着色（锡膏/PCB/钢网枚举来自后端，只着色不翻译） */
function stateColor(st: string): string {
  if (st === "ok" || st === "ready" || st === "using" || st === "done") return "#0f766e";
  if (st === "ing" || st === "warn_clean" || st === "warn_deep" || st === "overtime" || st === "released") return "#b45309";
  if (st === "expired" || st === "scrap" || st === "idle") return "#b91c1c";
  return "#64748b";
}

// ── 数据结构（实测信封 data 形状）────────────────────────────────────────────
interface MoOption {
  mo_no: string; product_code?: string; product_model?: string; line_code?: string;
  plan_qty?: number; done_qty?: number; status?: string;
}
interface RecSlot { machine_no?: string; slot_no?: string; feeder_no?: string; designators?: string; spec?: string; main_code?: string; is_alt?: boolean }
interface RecData {
  success?: boolean; msg?: string; model?: string; rj?: string; dt?: string;
  lot?: string; dc?: string; qty?: string; reel_sn?: string;
  slots?: RecSlot[]; recommend?: { machine_no?: string; slot_no?: string; feeder_no?: string } | null;
  no_slot?: boolean; need_manual?: boolean; from_baseline?: boolean; alt?: { scanned: string; main: string } | null;
}
interface CheckData { success?: boolean; msg?: string; expect_code?: string; spec?: string; designators?: string; model?: string }
interface LoadRow {
  id?: string; created_at?: string; mo_no?: string; machine_no?: string; slot_no?: string;
  feeder_no?: string; material_code?: string; lot_no?: string; reel_sn?: string;
  check_result?: string; fail_reason?: string;
}
interface PasteRow { material_code?: string; batch_no?: string; paste_type?: string; out_time?: string; status?: string; state?: string; state_text?: string }
interface PcbRow { reel_sn?: string; rj_code?: string; lot_no?: string; unseal_time?: string; bake_count?: number; status?: string; state?: string; state_text?: string }
interface StencilRow { sn?: string; stencil_no?: string; thickness?: string; models?: string; used_print_times?: number; max_print_times?: number; clean_count?: number; status?: string; state?: string; state_text?: string }
interface MsgOk { success?: boolean; msg?: string }
interface EquipCheckRow { check_date?: string; shift?: string; equip_type?: string; equip_no?: string; items?: string; result?: string; check_by?: string; created_at?: string }

// ═══════════════════════════ exec.loading · SMT 上料防错（PDA）═══════════════════════════
export function LoadingGuardView({ locale }: { locale: Locale }) {
  const [moRows, setMoRows] = useState<MoOption[]>([]);
  const [mo, setMo] = useState("");
  const [model, setModel] = useState("");
  const [reel, setReel] = useState("");
  const [rec, setRec] = useState<RecData | null>(null);
  const [machine, setMachine] = useState("");
  const [slot, setSlot] = useState("");
  const [feeder, setFeeder] = useState("");
  const [channel, setChannel] = useState("");
  const [oldCode, setOldCode] = useState("");
  const [newCode, setNewCode] = useState("");
  const [hist, setHist] = useState<LoadRow[]>([]);
  const [paste, setPaste] = useState<PasteRow[]>([]);
  const [pcb, setPcb] = useState<PcbRow[]>([]);
  const [stencil, setStencil] = useState<StencilRow[]>([]);
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const selRef = useRef<HTMLSelectElement>(null);

  const loadMos = useCallback(async () => {
    try {
      const d = await mesrjApi.get<{ rows?: MoOption[] }>("/order/mo/options");
      setMoRows(d?.rows || []);
    } catch (ex) { setErr(errText(ex)); }
  }, []);
  const loadHist = useCallback(async () => {
    try { setHist(await mesrjApi.get<LoadRow[]>("/smt/material_load") || []); }
    catch { setHist([]); }
  }, []);
  useEffect(() => {
    void loadMos(); void loadHist();
    setTimeout(() => selRef.current?.focus(), 300);
    void Promise.allSettled([
      mesrjApi.get<{ rows?: PasteRow[] }>("/smt/paste/list").then(d => setPaste((d?.rows || []).slice(0, 6))),
      mesrjApi.get<{ rows?: PcbRow[] }>("/smt/pcb/list").then(d => setPcb((d?.rows || []).slice(0, 6))),
      mesrjApi.get<{ rows?: StencilRow[] }>("/smt/stencil/list").then(d => setStencil((d?.rows || []).slice(0, 6))),
    ]);
  }, [loadMos, loadHist]);

  const selMo = moRows.find(x => x.mo_no === mo) || null;
  const overPlan = Boolean(selMo && Number(selMo.plan_qty || 0) > 0 && Number(selMo.done_qty || 0) >= Number(selMo.plan_qty || 0));

  const onMoChange = (v: string) => {
    setMo(v); setBanner(null);
    const m = moRows.find(x => x.mo_no === v) || null;
    setModel(m ? (m.product_model || m.product_code || "") : "");
    setRec(null);
  };
  const clearAll = (keepMo: boolean) => {
    setReel(""); setRec(null); setMachine(""); setSlot(""); setFeeder(""); setChannel(""); setBanner(null);
    if (!keepMo) { setMo(""); setModel(""); }
  };

  const recommend = async () => {
    if (busy) return;
    setErr(""); setBanner(null);
    if (!mo) { setBanner({ ok: false, text: `✕ ${t("w20.loading.needMo", locale)}` }); return; }
    if (!reel.trim()) { setBanner({ ok: false, text: `✕ ${t("w20.loading.needReel", locale)}` }); return; }
    setBusy(true);
    try {
      const r = await mesrjMsg.post<RecData>("/smt/load_recommend", { mo_no: mo, material_code: reel.trim() });
      const d: RecData = r.data ?? {};
      if (d.success !== false) {
        setRec(d);
        if (d.model) setModel(d.model);
        if (d.recommend) {
          setMachine(d.recommend.machine_no || ""); setSlot(d.recommend.slot_no || ""); setFeeder(d.recommend.feeder_no || "");
        }
        setBanner({ ok: true, text: `✓ ${d.msg || r.msg || t("success", locale)}` });
      } else {
        setRec(null);
        setBanner({ ok: false, text: d.msg || r.msg || t("w20.loading.parseFail", locale) });
      }
    } catch (ex) { setErr(errText(ex)); } finally { setBusy(false); }
  };
  const confirmLoad = async () => {
    if (busy) return;
    setErr(""); setBusy(true);
    try {
      const r = await mesrjMsg.post<CheckData>("/smt/load_check", {
        mo_no: mo, material_code: reel.trim(),
        machine_no: machine.trim(), slot_no: slot.trim(), feeder_no: feeder.trim(), channel: channel.trim(),
      });
      const d: CheckData = r.data ?? {};
      const ok = d.success !== false;
      let text = d.msg || r.msg || (ok ? t("success", locale) : t("failed", locale));
      if (!ok && d.expect_code) text += `\n${t("w20.loading.expect", locale)}：${d.expect_code} ${d.spec || ""} ${d.designators ? `（${t("designator", locale)} ${d.designators}）` : ""}`;
      setBanner({ ok, text: ok ? `✓ ${text}` : `✕ ${text}` });
      if (ok) { clearAll(true); void loadHist(); }
    } catch (ex) { setErr(errText(ex)); } finally { setBusy(false); }
  };
  const change = async () => {
    if (busy) return;
    setErr(""); setBusy(true);
    try {
      const r = await mesrjMsg.post<MsgOk>("/smt/load_change", { mo_no: mo, old_code: oldCode.trim(), new_code: newCode.trim() });
      const d: MsgOk = r.data ?? {};
      const ok = d.success !== false;
      setBanner({ ok, text: `${ok ? "✓" : "✕"} ${d.msg || r.msg || ""}` });
      if (ok) { setOldCode(""); setNewCode(""); void loadHist(); }
    } catch (ex) { setErr(errText(ex)); } finally { setBusy(false); }
  };
  const returnReel = async () => {
    if (busy) return;
    setErr(""); setBusy(true);
    try {
      const r = await mesrjMsg.post<MsgOk>("/smt/load_return", { material_code: oldCode.trim() || newCode.trim() });
      const d: MsgOk = r.data ?? {};
      const ok = d.success !== false;
      setBanner({ ok, text: `${ok ? "✓" : "✕"} ${d.msg || r.msg || ""}` });
      if (ok) void loadHist();
    } catch (ex) { setErr(errText(ex)); } finally { setBusy(false); }
  };

  const rec2 = rec && rec.success !== false ? rec : null;
  return (
    <div>
      <div style={{ ...box, display: "flex", gap: 8, alignItems: "baseline" }}>
        <b style={{ fontSize: 14 }}>{t("menu.exec.loading", locale)}</b>
        <span style={{ fontSize: 12, color: "#64748b" }}>{t("w20.loading.hint", locale)}</span>
      </div>
      <div style={{ ...box, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div>
          <div style={label}>{t("w20.loading.step1", locale)}</div>
          <select ref={selRef} value={mo} onChange={e => onMoChange(e.target.value)} style={{ ...inp, height: 40, minWidth: 260 }}>
            <option value="">{moRows.length ? t("w20.loading.pickMo", locale) : t("w20.loading.noMo", locale)}</option>
            {moRows.map(m => {
              const plan = Number(m.plan_qty || 0), done = Number(m.done_qty || 0);
              const over = plan > 0 && done >= plan;
              return (
                <option key={m.mo_no} value={m.mo_no}>
                  {`${m.mo_no}　${m.product_model || m.product_code || ""}${plan ? `　${t("w20.loading.planShort", locale)} ${plan}` : ""}${over ? `　⚠${t("mo_over", locale)}(${done})` : ""}`}
                </option>
              );
            })}
          </select>
        </div>
        <div>
          <div style={label}>{t("w20.loading.modelAuto", locale)}</div>
          <input value={model} readOnly style={{ ...inp, width: 180, height: 36, background: "#f8fafc", fontWeight: 700 }} />
        </div>
        <div>
          <div style={label}>{t("scan_reel", locale)}</div>
          <input value={reel} onChange={e => setReel(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void recommend(); } }}
            placeholder={t("w20.loading.reelPh", locale)}
            style={{ ...inp, width: 430, height: 38, border: "2px solid #3b82f6", fontFamily: "Consolas,monospace" }} />
        </div>
        <button disabled={busy} onClick={() => void recommend()}>{t("w20.loading.recommend", locale)}</button>
        <span style={{ flex: 1 }} />
        <button disabled={busy} onClick={() => void Promise.all([loadMos(), loadHist()])}>{t("refresh", locale)}</button>
      </div>

      <Err msg={err} />
      {overPlan && (
        <div style={{ padding: "10px 14px", borderRadius: 8, background: "#fef2f2", border: "1px solid #fca5a5", color: "#b91c1c", fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
          ⚠ {t("w20.loading.overWarn", locale)}（{t("out_qty", locale)} {Number(selMo?.done_qty || 0)} / {t("plan_qty", locale)} {Number(selMo?.plan_qty || 0)}）—— {t("w20.loading.overCheck", locale)}
        </div>
      )}

      {rec2 && (
        <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 10, padding: "12px 14px", marginBottom: 12, fontSize: 13 }}>
          <div style={{ marginBottom: 6 }}>
            <b>{t("w20.loading.parsed", locale)}</b>：
            {[[t("w18.c.rjCode", locale), rec2.rj], [t("w20.loading.dt", locale), rec2.dt], [t("lot", locale), rec2.lot],
              [t("w20.loading.dc", locale), rec2.dc], [t("qty", locale), rec2.qty], [t("reel_sn", locale), rec2.reel_sn]]
              .map(([k, v], i) => <span key={i} style={{ marginRight: 12 }}>{k} <span style={{ fontFamily: "monospace", fontWeight: 700 }}>{String(v || "-")}</span></span>)}
          </div>
          {rec2.alt && <div style={{ color: "#b45309", marginBottom: 6 }}>{t("alt_note", locale)}：{rec2.alt.scanned} → {rec2.alt.main}</div>}
          {rec2.recommend ? (
            <div style={{ color: "#0369a1", fontWeight: 600, marginBottom: 6 }}>
              {t("w20.loading.recPos", locale)}：{rec2.recommend.machine_no} {rec2.recommend.slot_no}（{t("w20.loading.lastPos", locale)}；{t("feeder", locale)} {rec2.recommend.feeder_no || "-"} {t("w20.loading.feederSwap", locale)}）
            </div>
          ) : rec2.no_slot ? (
            <div style={{ color: "#0369a1", marginBottom: 6 }}>{rec2.need_manual ? t("baseline_new", locale) : t("no_slot", locale)}</div>
          ) : (
            <div style={{ color: "#0369a1", fontWeight: 600, marginBottom: 6 }}>{t("w20.loading.slotsAllowed", locale)}</div>
          )}
          {(rec2.slots || []).map((sl, i) => {
            const isRec = rec2.recommend && rec2.recommend.machine_no === sl.machine_no && rec2.recommend.slot_no === sl.slot_no;
            return (
              <div key={i} style={{
                display: "flex", gap: 12, alignItems: "center", padding: "6px 10px", borderRadius: 8, marginBottom: 4, fontSize: 12.5,
                background: isRec ? "#ecfdf5" : "#f8fafc", border: `1px solid ${isRec ? "#10b981" : "#e2e8f0"}`,
              }}>
                <span style={{ fontFamily: "monospace", fontWeight: 700 }}>{sl.machine_no} {sl.slot_no}</span>
                <span style={{ color: "#64748b" }}>{t("feeder", locale)} {sl.feeder_no || "-"}</span>
                <span style={{ color: "#64748b" }}>{t("designator", locale)} {sl.designators || "-"}</span>
                <span style={{ color: "#64748b", flex: 1 }}>{sl.spec || ""}</span>
                {sl.is_alt ? <span style={{ color: "#b45309", fontWeight: 600 }}>{t("w20.loading.altTag", locale)}</span> : null}
                {isRec ? <span style={{ color: "#059669", fontWeight: 700 }}>★ {t("w20.loading.lastPos", locale)}</span> : null}
              </div>
            );
          })}
        </div>
      )}

      <div style={{ ...box, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div><div style={label}>{t("w20.loading.actualMachine", locale)}</div>
          <input value={machine} onChange={e => setMachine(e.target.value)} style={{ ...inp, width: 110, height: 36, fontFamily: "Consolas,monospace" }} /></div>
        <div><div style={label}>{t("w20.loading.actualSlot", locale)}</div>
          <input value={slot} onChange={e => setSlot(e.target.value)} style={{ ...inp, width: 90, height: 36, fontFamily: "Consolas,monospace" }} /></div>
        <div><div style={label}>{t("w20.loading.feederLoose", locale)}</div>
          <input value={feeder} onChange={e => setFeeder(e.target.value)} style={{ ...inp, width: 130, height: 36, fontFamily: "Consolas,monospace" }} /></div>
        <div><div style={label}>{t("w20.loading.channelOpt", locale)}</div>
          <input value={channel} onChange={e => setChannel(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void confirmLoad(); } }}
            style={{ ...inp, width: 80, height: 36, fontFamily: "Consolas,monospace" }} /></div>
        <button disabled={busy} onClick={() => void confirmLoad()}>{t("w20.loading.btnOk", locale)}</button>
        <button disabled={busy} onClick={() => clearAll(true)}>{t("w20.loading.btnClr", locale)}</button>
      </div>

      <Banner ok={Boolean(banner?.ok)} text={banner?.text || ""} />

      <div style={box}>
        <details>
          <summary style={{ cursor: "pointer", fontWeight: 600, color: "#334155", fontSize: 13 }}>{t("w20.loading.swapTitle", locale)}</summary>
          <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div><div style={label}>{t("old_reel", locale)}</div>
              <input value={oldCode} onChange={e => setOldCode(e.target.value)} style={{ ...inp, width: 330, height: 32, fontFamily: "Consolas,monospace" }} /></div>
            <div><div style={label}>{t("new_reel", locale)}</div>
              <input value={newCode} onChange={e => setNewCode(e.target.value)} style={{ ...inp, width: 330, height: 32, fontFamily: "Consolas,monospace" }} /></div>
            <button disabled={busy} onClick={() => void change()}>{t("w20.loading.btnChg", locale)}</button>
            <button disabled={busy} onClick={() => void returnReel()}>{t("w20.loading.btnRet", locale)}</button>
          </div>
          <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 6 }}>{t("scan_change_hint", locale)}</div>
        </details>
      </div>

      <div style={box}>
        <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 13 }}>{t("w20.loading.histTitle", locale)}</div>
        {hist.length ? (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>
                {[t("w18.c.time", locale), t("mo", locale), t("machine", locale), t("slot", locale), t("feeder", locale),
                  t("w18.c.rjCode", locale), t("lot", locale), t("reel_sn", locale), t("w20.loading.colResult", locale), t("w20.loading.colReason", locale)]
                  .map(h => <th key={h} style={th}>{h}</th>)}
              </tr></thead>
              <tbody>
                {hist.slice(0, 10).map(r => (
                  <tr key={String(r.id)}>
                    <td style={{ ...td, fontFamily: "monospace" }}>{String(r.created_at || "").replace("T", " ").slice(0, 19)}</td>
                    <td style={{ ...td, fontFamily: "monospace" }}>{r.mo_no || ""}</td>
                    <td style={{ ...td, fontFamily: "monospace" }}>{r.machine_no || ""}</td>
                    <td style={{ ...td, fontFamily: "monospace" }}>{r.slot_no || ""}</td>
                    <td style={{ ...td, fontFamily: "monospace" }}>{r.feeder_no || ""}</td>
                    <td style={{ ...td, fontFamily: "monospace" }}>{r.material_code || ""}</td>
                    <td style={{ ...td, fontFamily: "monospace" }}>{r.lot_no || ""}</td>
                    <td style={{ ...td, fontFamily: "monospace" }}>{r.reel_sn || ""}</td>
                    <td style={{ ...td, fontWeight: 700, color: r.check_result === "OK" ? "#0f766e" : "#b91c1c" }}>{r.check_result === "OK" ? "✓" : "✕"}</td>
                    <td style={{ ...td, color: "#64748b", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.fail_reason || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div style={{ color: "#94a3b8", fontSize: 13 }}>{t("w20.loading.noHist", locale)}</div>}
      </div>

      <div style={{ ...box, display: "flex", gap: 14, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 13 }}>{t("smta.tab.paste", locale)}</div>
          {paste.length ? paste.map((p, i) => (
            <div key={i} style={{ display: "flex", gap: 8, fontSize: 12, padding: "3px 0", borderBottom: "1px solid #f1f5f9" }}>
              <span style={{ fontFamily: "monospace", flex: 1 }}>{p.material_code || ""} {p.batch_no || ""}</span>
              <b style={{ color: stateColor(p.state || "") }}>{p.state_text || p.status || "-"}</b>
            </div>
          )) : <div style={{ color: "#94a3b8", fontSize: 12 }}>{t("no_data", locale)}</div>}
        </div>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 13 }}>{t("w20.loading.pcbTitle", locale)}</div>
          {pcb.length ? pcb.map((p, i) => (
            <div key={i} style={{ display: "flex", gap: 8, fontSize: 12, padding: "3px 0", borderBottom: "1px solid #f1f5f9" }}>
              <span style={{ fontFamily: "monospace", flex: 1 }}>{p.reel_sn || ""}（{t("w18.c.bakeCount", locale)} {p.bake_count ?? 0}）</span>
              <b style={{ color: stateColor(p.state || "") }}>{p.state_text || p.status || "-"}</b>
            </div>
          )) : <div style={{ color: "#94a3b8", fontSize: 12 }}>{t("no_data", locale)}</div>}
        </div>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 13 }}>{t("smta.tab.stencil", locale)}</div>
          {stencil.length ? stencil.map((s, i) => (
            <div key={i} style={{ display: "flex", gap: 8, fontSize: 12, padding: "3px 0", borderBottom: "1px solid #f1f5f9" }}>
              <span style={{ fontFamily: "monospace", flex: 1 }}>{s.sn || ""}（{s.used_print_times ?? 0}/{s.max_print_times ?? 0}）</span>
              <b style={{ color: stateColor(s.state || "") }}>{s.state_text || s.status || "-"}</b>
            </div>
          )) : <div style={{ color: "#94a3b8", fontSize: 12 }}>{t("no_data", locale)}</div>}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════ exec.fa · 首件确认 / 设备点检 ═══════════════════════════
const FA_TRIGGERS = ["换机型", "换钢网", "换物料批次", "换锡膏"] as const;
const FA_TRIG_KEYS: Record<string, string> = { 换机型: "w20.fa.trig.model", 换钢网: "w20.fa.trig.stencil", 换物料批次: "w20.fa.trig.lot", 换锡膏: "w20.fa.trig.paste" };
const EQ_TYPES = ["印刷机", "贴片机", "点胶机"] as const;
const EQ_TYPE_KEYS: Record<string, string> = { 印刷机: "w20.fa.eq.printer", 贴片机: "w20.fa.eq.picker", 点胶机: "w20.fa.eq.dispenser" };

export function FaCheckView({ locale }: { locale: Locale }) {
  const [moRows, setMoRows] = useState<MoOption[]>([]);
  const [faMo, setFaMo] = useState("");
  const [faTrig, setFaTrig] = useState<string>(FA_TRIGGERS[0]);
  const [faRes, setFaRes] = useState("OK");
  const [eqType, setEqType] = useState<string>(EQ_TYPES[0]);
  const [eqNo, setEqNo] = useState("");
  const [eqItems, setEqItems] = useState("");
  const [eqRes, setEqRes] = useState("OK");
  const [eqLog, setEqLog] = useState<EquipCheckRow[]>([]);
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const moRef = useRef<HTMLInputElement>(null);

  const loadEqLog = useCallback(async () => {
    try { setEqLog(await mesrjApi.get<EquipCheckRow[]>("/smt/equip_check") || []); }
    catch { setEqLog([]); }
  }, []);
  useEffect(() => {
    void mesrjApi.get<{ rows?: MoOption[] }>("/order/mo/options").then(d => setMoRows(d?.rows || [])).catch(() => setMoRows([]));
    void loadEqLog();
    setTimeout(() => moRef.current?.focus(), 300);
  }, [loadEqLog]);

  const run = async (fn: () => Promise<{ ok: boolean; text: string }>) => {
    if (busy) return;
    setErr(""); setBusy(true);
    try {
      const r = await fn();
      setBanner({ ok: r.ok, text: `${r.ok ? "✓" : "✕"} ${r.text}` });
    } catch (ex) { setErr(errText(ex)); setBanner(null); }
    finally { setBusy(false); }
  };

  const faConfirm = () => run(async () => {
    const r = await mesrjMsg.post<MsgOk>("/smt/fa/confirm", { mo_no: faMo.trim(), trigger_type: faTrig, result: faRes });
    const d: MsgOk = r.data ?? {};
    return { ok: d.success !== false, text: d.msg || r.msg || "" };
  });
  const faStatus = () => {
    if (!faMo.trim()) { setErr(""); setBanner({ ok: false, text: `✕ ${t("w20.fa.needMo", locale)}` }); return; }
    void run(async () => {
      const r = await mesrjMsg.get<MsgOk>("/smt/fa/status", { mo_no: faMo.trim() });
      const d: MsgOk = r.data ?? {};
      return { ok: d.success !== false, text: d.msg || r.msg || "" };
    });
  };
  const eqSubmit = () => run(async () => {
    const r = await mesrjMsg.post<MsgOk>("/smt/equip/check", { equip_type: eqType, equip_no: eqNo.trim(), items: eqItems.trim(), result: eqRes });
    const d: MsgOk = r.data ?? {};
    if (d.success !== false) void loadEqLog();
    return { ok: d.success !== false, text: d.msg || r.msg || "" };
  });
  const eqPreCheck = () => run(async () => {
    const r = await mesrjMsg.get<MsgOk>("/smt/equip/status", { equip_type: eqType });
    const d: MsgOk = r.data ?? {};
    return { ok: d.success !== false, text: d.msg || r.msg || "" };
  });

  return (
    <div>
      <div style={{ ...box, display: "flex", gap: 8, alignItems: "baseline" }}>
        <b style={{ fontSize: 14 }}>{t("menu.exec.fa", locale)}</b>
        <span style={{ fontSize: 12, color: "#64748b" }}>{t("w20.fa.hint", locale)}</span>
      </div>

      <div style={box}>
        <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 13 }}>{t("w20.fa.faTitle", locale)}</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div><div style={label}>{t("mo", locale)}</div>
            <input ref={moRef} value={faMo} onChange={e => setFaMo(e.target.value)} list="w20-fa-mo-list"
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void faStatus(); } }}
              style={{ ...inp, width: 200, height: 34, fontFamily: "Consolas,monospace" }} />
            <datalist id="w20-fa-mo-list">{moRows.map(m => <option key={m.mo_no} value={m.mo_no} />)}</datalist></div>
          <div><div style={label}>{t("w20.fa.trigger", locale)}</div>
            <select value={faTrig} onChange={e => setFaTrig(e.target.value)} style={{ ...inp, height: 34 }}>
              {FA_TRIGGERS.map(v => <option key={v} value={v}>{t(FA_TRIG_KEYS[v], locale)}</option>)}
            </select></div>
          <div><div style={label}>{t("w20.fa.faResult", locale)}</div>
            <select value={faRes} onChange={e => setFaRes(e.target.value)} style={{ ...inp, height: 34 }}>
              <option value="OK">OK</option><option value="NG">NG</option>
            </select></div>
          <button disabled={busy} onClick={() => void faConfirm()}>{t("w20.fa.btnFaOk", locale)}</button>
          <button disabled={busy} onClick={() => void faStatus()}>{t("w20.fa.btnFaQ", locale)}</button>
        </div>
      </div>

      <div style={box}>
        <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 13 }}>{t("w20.fa.eqTitle", locale)}</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div><div style={label}>{t("w18.c.deviceType", locale)}</div>
            <select value={eqType} onChange={e => setEqType(e.target.value)} style={{ ...inp, height: 34 }}>
              {EQ_TYPES.map(v => <option key={v} value={v}>{t(EQ_TYPE_KEYS[v], locale)}</option>)}
            </select></div>
          <div><div style={label}>{t("w20.fa.eqNo", locale)}</div>
            <input value={eqNo} onChange={e => setEqNo(e.target.value)} style={{ ...inp, width: 120, height: 34, fontFamily: "Consolas,monospace" }} /></div>
          <div><div style={label}>{t("w20.fa.eqItems", locale)}</div>
            <input value={eqItems} onChange={e => setEqItems(e.target.value)} placeholder={t("w20.fa.eqItemsPh", locale)}
              style={{ ...inp, width: 260, height: 34, fontFamily: "Consolas,monospace" }} /></div>
          <div><div style={label}>{t("w20.fa.eqResult", locale)}</div>
            <select value={eqRes} onChange={e => setEqRes(e.target.value)} style={{ ...inp, height: 34 }}>
              <option value="OK">OK</option><option value="NG">NG</option>
            </select></div>
          <button disabled={busy} onClick={() => void eqSubmit()}>{t("w20.fa.btnEqOk", locale)}</button>
          <button disabled={busy} onClick={() => void eqPreCheck()}>{t("w20.fa.btnEqPre", locale)}</button>
        </div>
      </div>

      <Err msg={err} />
      <Banner ok={Boolean(banner?.ok)} text={banner?.text || ""} />

      <div style={box}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
          <span style={{ fontWeight: 600, fontSize: 13 }}>{t("w20.fa.eqLogTitle", locale)}</span>
          <span style={{ flex: 1 }} />
          <button disabled={busy} onClick={() => void loadEqLog()}>{t("refresh", locale)}</button>
        </div>
        {eqLog.length ? (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>
                {[t("w18.c.workDate", locale), t("w18.c.shift", locale), t("w18.c.deviceType", locale), t("w20.fa.eqNo", locale),
                  t("w20.fa.eqItems", locale), t("w20.fa.eqResult", locale), t("w18.c.operator", locale)].map(h => <th key={h} style={th}>{h}</th>)}
              </tr></thead>
              <tbody>
                {eqLog.slice(0, 15).map((r, i) => (
                  <tr key={i}>
                    <td style={{ ...td, fontFamily: "monospace" }}>{r.check_date || ""}</td>
                    <td style={{ ...td, fontFamily: "monospace" }}>{r.shift || ""}</td>
                    <td style={td}>{EQ_TYPE_KEYS[r.equip_type || ""] ? t(EQ_TYPE_KEYS[r.equip_type || ""], locale) : r.equip_type || ""}</td>
                    <td style={{ ...td, fontFamily: "monospace" }}>{r.equip_no || ""}</td>
                    <td style={{ ...td, color: "#64748b", maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.items || ""}</td>
                    <td style={{ ...td, fontWeight: 700, color: String(r.result || "").toUpperCase() === "OK" ? "#0f766e" : "#b91c1c" }}>{r.result || ""}</td>
                    <td style={td}>{r.check_by || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div style={{ color: "#94a3b8", fontSize: 13 }}>{t("w20.fa.noEqLog", locale)}</div>}
      </div>
    </div>
  );
}
