// ============================================================================
// MES-ruijing W20 前端（DIP 段）—— exec.dippass / exec.tracebind 两屏移植
// 源：ruijing-mes-ref/web/pages.js L17025（DIP 过站·整版）、L12440（SN 绑定/追溯）
// 后端全部复用 mesrj 既有接口（2026-11-23 本地 8080 实测）：
//   GET  /order/mo/options        工单下拉 → {rows:[{mo_no,product_model,plan_qty,status,process_code,...}]}
//   GET  /exec/mo/:moNo/route     工单路线 → {steps:[{station_code,station_name,process_code,seq_no,...}]}
//   GET  /md/station?size=200     工位主数据（无路线时的 DIP 兜底）→ {rows:[{station_code,station_name,...}]}
//   GET  /panel/view?sn           整版带出 → {base,layout:{cols,rows,total,model},slots:[{sn,panel_pos,row,col}],aoi}
//   GET  /exec/pass/list          过站记录 → {rows:[{sn,station_code,result,pass_time,...}],total}（本站/上一枪/168h 由此端算）
//   POST /exec/pass_panel         整版过站（逐块走 do_pass_inner 防错）→ {panel,ok,ng,results:[{sn,panel_pos,ok,msg}]}
//   GET  /exec/hourly             今日小时过站（全产线口径，服务端不按 mo/工位过滤）→ {day,hours:[{hour,total,ok_qty,ng_qty}],by_station,total:{total,ok_qty,ng_qty,yield}}
//   GET  /smt/sn_trace?sn         SMT 绑定追溯 → {success:false,msg} 或 {success:true,bind:{mo_no,model,machine_no,channel,feeder_no,material_sn,stencil_sn,paste_sn,pcb_reel_sn,operator,prod_time}}
//   POST /smt/sn_import           批量导入绑定 {rows:[...]} → {success,msg}
//   GET  /repair/pending-summary  待维修汇总 → {rows:[{station_code,qty,first_at,last_at,defects,line_code}],total}
// ============================================================================
import { useCallback, useEffect, useRef, useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { mesrjApi, mesrjMsg, MesrjApiError } from "./api";
import { t } from "./i18n";

const box = { border: "1px solid var(--border, #e2e8f0)", borderRadius: 10, padding: 14, marginBottom: 14 } as const;
const inp = { padding: "6px 8px", marginRight: 6 } as const;
const muted = { color: "#64748b", fontSize: 12 } as const;

function Err({ msg }: { msg: string }) {
  if (!msg) return null;
  return <div style={{ color: "#b91c1c", padding: "6px 0", fontSize: 13, whiteSpace: "pre-wrap" }}>{msg}</div>;
}
function Ok({ msg }: { msg: string }) {
  if (!msg) return null;
  return <div style={{ color: "#15803d", padding: "6px 0", fontSize: 13 }}>{msg}</div>;
}

async function call<T>(fn: () => Promise<T>): Promise<[T | null, string]> {
  try { return [await fn(), ""]; }
  catch (ex) { return [null, ex instanceof MesrjApiError ? ex.message : String(ex)]; }
}

/** ISO 或 "YYYY-MM-DD HH:MM:SS" → HH:MM */
function hhmm(s?: string | null): string {
  if (!s) return "";
  const d = new Date(s);
  return isNaN(d.getTime()) ? String(s).slice(11, 16) : d.toTimeString().slice(0, 5);
}

// SMT 下线 → DIP 投产时效（源 exec.dippass 的 168H 管控，阈值与源一致）
const AGING_LIMIT_H = 168;

// ════════════════════════════════════════════════════════════════════════════
// exec.dippass —— DIP 过站（整版）：扫一块 → 带出整版 → 自动逐块过站
// ════════════════════════════════════════════════════════════════════════════

interface MoOpt {
  mo_no: string; product_code?: string; product_model?: string;
  plan_qty?: number; status?: string; process_code?: string; done_qty?: number;
}
interface RouteStep { station_code: string; station_name?: string; process_code?: string; seq_no?: number }
interface StationRow { station_code: string; station_name?: string; process_code?: string }
interface PanelSlotRaw { sn: string; panel_pos: string; row: number; col: number }
interface PanelView {
  base: { sn: string; product_code?: string; mo_no?: string; status?: string; cur_station?: string } | null;
  layout: { cols?: number; rows?: number; total?: number; model?: string } | null;
  slots: PanelSlotRaw[] | null;
  aoi: Array<Record<string, unknown>> | null;
}
interface PassRow { sn: string; station_code: string; result: string; pass_time: string; ng_code?: string }
interface HourlyHour { hour: string; total: number; ok_qty: number; ng_qty: number }
interface HourlyData {
  day: string;
  hours: HourlyHour[];
  by_station: Array<{ station_code: string; total: number; ng_qty: number }>;
  total: { total: number; ok_qty: number; ng_qty: number; yield: number | string };
}
interface PassPanelResp { panel?: number; ok?: number; ng?: number; results?: Array<{ sn: string; panel_pos?: string; ok: boolean; msg?: string }> }

/** 一格：槽位 + 本站状态 + 上一枪 + 168h 时效 */
interface DipSlot extends PanelSlotRaw {
  passed: boolean; pass_time: string; result: string;
  last_station: string; last_time: string; last_result: string;
  aoi_time: string;
  left_h: number | null; expired: boolean;
}

interface DipBox {
  kind: "ok" | "warn" | "err" | "info";
  head: string;
  lines?: string[];
  blocked?: Array<{ sn: string; msg: string }>;
  fixLeft?: number; // >0 → 提示里带「补过剩余 N 块」按钮
}

const BOX_STYLE: Record<DipBox["kind"], { bg: string; bd: string; fg: string }> = {
  ok: { bg: "#F0FDF4", bd: "#86EFAC", fg: "#14532D" },
  warn: { bg: "#FFF7ED", bd: "#FDBA74", fg: "#9A3412" },
  err: { bg: "#FEF2F2", bd: "#FCA5A5", fg: "#991B1B" },
  info: { bg: "#F8FAFC", bd: "#CBD5E1", fg: "#334155" },
};
const MO_TAG: Record<string, string> = { "已排产": "#2563eb", "生产中": "#15803d", "待排产": "#64748b", "已下达": "#b45309" };

/** 过站结果卡：标题 + 说明行 + 被拦明细 + 可选「补过剩余」按钮 */
function ResultBox({ box: b, locale, onFix }: { box: DipBox; locale: Locale; onFix: () => void }) {
  const st = BOX_STYLE[b.kind];
  return (
    <div style={{ marginTop: 10, background: st.bg, border: `1px solid ${st.bd}`, borderLeft: `4px solid ${st.bd}`, borderRadius: 8, padding: "10px 14px", fontSize: 13.5, lineHeight: 1.7, color: st.fg }}>
      <b>{b.head}</b>
      {(b.lines || []).map((l, i) => <div key={i} style={{ opacity: 0.9 }}>{l}</div>)}
      {(b.blocked || []).map(x => (
        <div key={x.sn} style={{ display: "flex", gap: 10, fontFamily: "Consolas,monospace", fontSize: 12 }}>
          <span>{x.sn}</span><span>{x.msg}</span>
        </div>
      ))}
      {b.fixLeft ? (
        <div style={{ marginTop: 8 }}>
          <button onClick={onFix} style={{ fontWeight: 600 }}>
            {t("w20.dip.btnFix", locale)} {b.fixLeft} {t("w20.dip.blocks", locale)}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function DipPassView({ locale }: { locale: Locale }) {
  const [mos, setMos] = useState<MoOpt[]>([]);
  const [mo, setMo] = useState("");
  const [stations, setStations] = useState<StationRow[]>([]);
  const [station, setStation] = useState("");
  const [autoPass, setAutoPass] = useState(true);
  const [snIn, setSnIn] = useState("");
  const [anchor, setAnchor] = useState("");
  const [slots, setSlots] = useState<DipSlot[]>([]);
  const [panelCols, setPanelCols] = useState(4);
  const [panelNote, setPanelNote] = useState("");
  const [resBox, setResBox] = useState<DipBox | null>(null);
  const [hourly, setHourly] = useState<HourlyData | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const snRef = useRef<HTMLInputElement>(null);

  const moCur = mos.find(x => x.mo_no === mo) || null;
  const doneN = slots.filter(x => x.passed).length;
  const aoiPendN = slots.filter(x => !x.last_station && x.aoi_time).length;
  const noRecN = slots.filter(x => !x.last_station && !x.aoi_time).length;
  const expN = slots.filter(x => x.expired).length;

  // ── 工位下拉：路线里 02（插件）段优先，整单路线全给，再兜底 /md/station 的 DIP 工位 ──
  const loadStations = useCallback(async (moNo: string) => {
    let opts: StationRow[] = [];
    if (moNo) {
      const [d] = await call(() => mesrjApi.get<{ steps: RouteStep[] }>(`/exec/mo/${encodeURIComponent(moNo)}/route`));
      const steps = d?.steps || [];
      const dip = steps.filter(s => (s.process_code || "") === "02");
      opts = (dip.length ? dip : steps).map(s => ({ station_code: s.station_code, station_name: s.station_name || s.station_code, process_code: s.process_code }));
    }
    if (!opts.length) {
      const [sd] = await call(() => mesrjApi.get<{ rows: StationRow[] }>("/md/station", { size: 200 }));
      const rows = sd?.rows || [];
      const dip = rows.filter(x => /DIP/i.test(x.station_code) || x.process_code === "02");
      opts = dip.length ? dip : rows;
    }
    setStations(opts);
    setStation((opts.find(x => /DIP-PASS/i.test(x.station_code)) || opts[0])?.station_code || "");
  }, []);

  const loadMos = useCallback(async () => {
    const [d, e] = await call(() => mesrjApi.get<{ rows: MoOpt[] }>("/order/mo/options"));
    if (e || !d) { setErr(e); return; }
    const rows = d.rows || [];
    // 整单工单（process_code 空）含插件段，必须列出；老的纯分段单只留 02
    const live = rows.filter(x => !x.process_code || x.process_code === "02");
    setMos(live.length ? live : rows);
  }, []);

  const loadHourly = useCallback(async () => {
    const [d] = await call(() => mesrjApi.get<HourlyData>("/exec/hourly"));
    if (d) setHourly(d);
  }, []);

  useEffect(() => { void loadMos(); void loadHourly(); }, [loadMos, loadHourly]);
  useEffect(() => {
    if (!mo) { void loadStations(""); return; }
    void loadStations(mo);
    setSlots([]); setPanelNote(""); setResBox(null); setAnchor("");
  }, [mo, loadStations]);
  useEffect(() => { if (!station) return; setSlots([]); setPanelNote(""); setResBox(null); setAnchor(""); }, [station]);
  useEffect(() => { snRef.current?.focus(); }, []);

  // ── 带出整版：/panel/view 推槽位，/exec/pass/list（工单全量）算本站/上一枪/168h ──
  const buildPanel = useCallback(async (code: string): Promise<{ list: DipSlot[]; failMsg: string }> => {
    const [pv, e1] = await call(() => mesrjApi.get<PanelView>("/panel/view", { sn: code }));
    if (e1) return { list: [], failMsg: e1 };
    if (!pv || !pv.base) return { list: [], failMsg: `${t("no_data", locale)}：${code}` };
    const moNo = mo || pv.base.mo_no || "";
    const [pl, e2] = await call(() => mesrjApi.get<{ rows: PassRow[]; total: number }>("/exec/pass/list", { mo_no: moNo, size: 500 }));
    if (e2) return { list: [], failMsg: e2 };
    const rows = pl?.rows || []; // pass_time DESC
    const here = new Map<string, PassRow>();   // 本站最新一枪
    const last = new Map<string, PassRow>();   // 上一枪（其它工位最新）
    const first = new Map<string, string>();   // 最早过站时间（≈SMT 下线）
    for (const r of rows) {
      if (r.station_code === station) { if (!here.has(r.sn)) here.set(r.sn, r); }
      else { if (!last.has(r.sn)) last.set(r.sn, r); }
      first.set(r.sn, r.pass_time); // DESC 顺扫，最后写入即最早
    }
    const aoiT = new Map<string, string>();
    for (const a of pv.aoi || []) {
      const pcb = String(a.pcb_sn || ""); const tt = String(a.test_time || "");
      if (pcb && tt && !aoiT.has(pcb)) aoiT.set(pcb, tt);
    }
    const list: DipSlot[] = (pv.slots || []).map(s => {
      const h = here.get(s.sn); const l = last.get(s.sn); const ft = first.get(s.sn);
      let left: number | null = null;
      if (ft) {
        const age = (Date.now() - new Date(ft).getTime()) / 36e5;
        left = !isNaN(age) ? Math.round(AGING_LIMIT_H - age) : null;
      }
      return {
        ...s,
        passed: !!h, pass_time: h ? h.pass_time : "", result: h ? h.result : "",
        last_station: l ? l.station_code : "", last_time: l ? l.pass_time : "", last_result: l ? l.result : "",
        aoi_time: aoiT.get(s.sn) || "",
        left_h: left, expired: left !== null && left < 0,
      };
    });
    const lay = pv.layout;
    setPanelCols(lay?.cols || Math.max(4, ...list.map(x => x.col || 0)));
    setPanelNote(lay
      ? `${list.length} ${t("w20.dip.blocks", locale)}${lay.model ? ` · ${lay.model}` : ""} · ${lay.rows || "?"}×${lay.cols || "?"}`
      : t("w20.dip.noLayout", locale));
    return { list, failMsg: lay ? "" : t("w20.dip.noLayout", locale) };
  }, [mo, station, locale]);

  const resetPanel = () => { setSlots([]); setPanelNote(""); setResBox(null); setAnchor(""); setSnIn(""); snRef.current?.focus(); };

  // ── 整版过站（auto=true：扫码触发不再弹确认）──
  const passAll = useCallback(async (baseSn: string, auto: boolean, dupNote?: string) => {
    if (!baseSn || !station) return;
    if (!auto && !window.confirm(
      `${t("w20.dip.confirm", locale)}\n\n${t("sn.field.station_code", locale)}: ${station}\n${t("mo", locale)}: ${mo || "-"}`)) return;
    setBusy(true);
    const [d, e] = await call(() => mesrjMsg.post<PassPanelResp>("/exec/pass_panel", {
      mo_no: mo, station_code: station, sn: baseSn, result: "OK",
    }));
    if (e || !d) {
      setBusy(false);
      setResBox({ kind: "err", head: `${t("w20.dip.passFail", locale)}：${e}`, lines: dupNote ? [dupNote] : undefined });
      return;
    }
    const rs = d.data?.results || [];
    const blocked = rs.filter(x => !x.ok).map(x => ({ sn: x.sn, msg: x.msg || "" }));
    const okN = Number(d.data?.ok || 0);
    setResBox({
      kind: blocked.length ? "warn" : "ok",
      head: blocked.length
        ? t("w20.dip.partBlocked", locale)
        : (auto ? t("w20.dip.autoOk", locale) : t("w20.dip.okHead", locale)),
      lines: [`${t("w20.dip.passedN", locale)} ${okN} / ${rs.length}`, d.msg].filter(Boolean)
        .concat(dupNote ? [dupNote] : []),
      blocked: blocked.length ? blocked : undefined,
    });
    // 过站后重查整版状态（提示按新状态重算，不把过站前的旧态留在屏上）
    const [after] = await call(() => buildPanel(baseSn));
    if (after && after.list.length) setSlots(after.list);
    void loadHourly();
    setBusy(false);
    setSnIn(""); snRef.current?.focus();
  }, [mo, station, buildPanel, loadHourly, locale]);

  const doScan = useCallback(async () => {
    const code = snIn.trim();
    if (!code || busy) return;
    if (!station) { setResBox({ kind: "err", head: t("w20.dip.needStation", locale) }); return; }
    setBusy(true);
    setResBox({ kind: "info", head: t("w20.dip.querying", locale) });
    const { list, failMsg } = await buildPanel(code);
    setSlots(list);
    setBusy(false);
    const total = list.length;
    if (!total) {
      setResBox({ kind: "err", head: failMsg || t("w20.dip.noLayout", locale) });
      setSnIn(""); snRef.current?.focus(); return;
    }
    const done = list.filter(x => x.passed).length;
    const cur = list.find(x => x.sn === code);
    const nExp = list.filter(x => x.expired).length;
    const nNoRec = list.filter(x => !x.last_station && !x.aoi_time).length;
    const notes = [
      nExp ? `⚠ ${t("w20.dip.overH", locale)} ${nExp}` : "",
      nNoRec ? `⚠ ${nNoRec} ${t("w20.dip.noRecShort", locale)}` : "",
    ].filter(Boolean);
    const withNotes = (b: DipBox): DipBox =>
      (b.lines || b.blocked || !notes.length) ? b : { ...b, lines: notes };

    if (cur && cur.passed) {
      const left = total - done;
      const dup = `${t("w20.dip.dup", locale)} ${code} ${t("w20.dip.dupAt", locale)} ${hhmm(cur.pass_time)}`;
      setAnchor(code);
      if (left > 0 && autoPass) {
        // 抓到已过的那块 → 补过本版剩下的，别让现场自己找按钮
        setResBox({ kind: "warn", head: dup, lines: [`${t("w20.dip.dupRemain", locale)} ${left}`] });
        void passAll(code, true, dup);
        return;
      }
      setResBox(withNotes({ kind: "warn", head: dup,
        lines: [`${t("w20.dip.prog", locale)} ${done} / ${total}`],
        fixLeft: left > 0 ? left : undefined }));
      setSnIn(""); snRef.current?.focus(); return;
    }
    setAnchor(code);
    if (done >= total) {
      setResBox(withNotes({ kind: "warn", head: t("w20.dip.allDone", locale) }));
      setSnIn(""); snRef.current?.focus(); return;
    }
    if (!autoPass) {
      setResBox(withNotes({ kind: "info", head: `${t("w20.dip.manualTip", locale)}　${t("w20.dip.prog", locale)} ${done} / ${total}` }));
      setSnIn(""); snRef.current?.focus(); return;
    }
    void passAll(code, true);
  }, [snIn, busy, station, autoPass, buildPanel, passAll, locale]);

  const hourlyTotal = hourly?.total?.total ?? 0;
  const hmax = Math.max(1, ...(hourly?.hours || []).map(h => Number(h.total || 0)));
  const peak = (hourly?.hours || []).reduce<HourlyHour | null>((p, h) => (!p || h.total > p.total ? h : p), null);

  return (
    <div>
      {/* 工具条：工单 · 工位 · 扫码即过站 · 进度 */}
      <div style={{ ...box, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <span style={muted}>{t("mo", locale)}</span>
        <select value={mo} onChange={e => setMo(e.target.value)} style={{ ...inp, minWidth: 170 }}>
          {!mo && <option value="">{mos.length ? t("w20.dip.pickMo", locale) : t("w20.dip.noMo", locale)}</option>}
          {mos.map(x => <option key={x.mo_no} value={x.mo_no}>{x.mo_no}</option>)}
        </select>
        {moCur && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "3px 10px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12 }}>
            <b style={{ fontSize: 13, color: "#0f172a" }}>{moCur.product_model || moCur.product_code || "—"}</b>
            <span style={muted}>{t("w20.dip.plan", locale)} <b style={{ fontFamily: "monospace", color: "#0f172a" }}>{moCur.plan_qty || 0}</b></span>
            <span style={{ color: MO_TAG[moCur.status || ""] || "#64748b", fontWeight: 600, fontSize: 12 }}>{moCur.status || ""}</span>
          </span>
        )}
        <span style={muted}>{t("sn.field.station_code", locale)}</span>
        <select value={station} onChange={e => setStation(e.target.value)} style={{ ...inp, minWidth: 150 }}>
          {!stations.length && <option value="">—</option>}
          {stations.map(x => <option key={x.station_code} value={x.station_code}>{x.station_name || x.station_code}</option>)}
        </select>
        <span style={{ fontFamily: "monospace", ...muted }}>{station}</span>
        <label style={{ ...muted, display: "inline-flex", alignItems: "center", gap: 5, cursor: "pointer" }} title={t("w20.dip.autoTip", locale)}>
          <input type="checkbox" checked={autoPass} onChange={e => setAutoPass(e.target.checked)} />
          {t("w20.dip.auto", locale)}
        </label>
        <span style={{ flex: 1 }} />
        {slots.length > 0 && (
          <span style={{ fontSize: 13 }}>
            {t("w20.dip.prog", locale)} <b>{doneN}</b> / {slots.length}
            {aoiPendN > 0 && <span style={{ color: "#475569" }}>　{t("w20.dip.aoiPend", locale)} {aoiPendN}</span>}
            {expN > 0 && <span style={{ color: "#b91c1c", fontWeight: 600 }}>　⚠ {t("w20.dip.overH", locale)} {expN}</span>}
            {noRecN > 0 && <span style={{ color: "#b45309", fontWeight: 600 }}>　⚠ {noRecN} {t("w20.dip.noRecShort", locale)}</span>}
          </span>
        )}
        <button onClick={() => { void loadHourly(); }}>{t("refresh", locale)}</button>
      </div>
      <Err msg={err} />

      {/* 扫码框：大字号、回车即过（扫码枪自带回车） */}
      <div style={box}>
        <input
          ref={snRef} value={snIn} autoComplete="off"
          onChange={e => setSnIn(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void doScan(); } }}
          placeholder={t("w20.dip.scanPh", locale)}
          style={{ width: "100%", height: 48, fontSize: 18, fontFamily: "Consolas,monospace", padding: "0 14px", border: "2px solid #CBD5E1", borderRadius: 8, outline: "none", boxSizing: "border-box" }}
        />
        {resBox && (
          <ResultBox box={resBox} locale={locale} onFix={() => void passAll(anchor, true, resBox.head)} />
        )}
      </div>

      {/* 拼版状态 */}
      <div style={box}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
          <b style={{ fontSize: 15 }}>{t("w20.dip.panelState", locale)}</b>
          <span style={muted}>{panelNote}</span>
          <span style={{ flex: 1 }} />
          <button
            disabled={!slots.length || doneN >= slots.length || busy}
            onClick={() => void passAll(anchor || slots.find(x => x.passed)?.sn || slots[0]?.sn || "", false)}
          >
            {busy ? t("w20.dip.passing", locale) : t("w20.dip.passall", locale)}
          </button>
          {slots.length > 0 && <button onClick={resetPanel}>{t("w20.dip.clear", locale)}</button>}
        </div>
        {!slots.length ? (
          <div style={{ padding: 26, textAlign: "center", ...muted }}>{t("w20.dip.panelHint", locale)}</div>
        ) : (
          <div style={{ display: "grid", gap: 8, gridTemplateColumns: `repeat(${panelCols},1fr)` }}>
            {slots.map(x => {
              const cls = x.passed ? "ok" : x.result === "NG" ? "err" : "wait";
              const bd = cls === "ok" ? "#16a34a" : cls === "err" ? "#dc2626" : "#CBD5E1";
              const bg = cls === "ok" ? "#F0FDF4" : cls === "err" ? "#FEF2F2" : "#fff";
              const lastLine = x.last_station
                ? `↑ ${x.last_station.replace(/^[A-Z]+-L\d+-/, "")} ${hhmm(x.last_time)}${x.last_result === "OK" ? " ✓" : ` ${x.last_result}`}`
                : x.aoi_time
                  ? `↑ ${t("w20.dip.aoiChecked", locale)} ${hhmm(x.aoi_time)}`
                  : `↑ ${t("w20.dip.noRecord", locale)}`;
              return (
                <div key={x.sn} style={{ border: `2px solid ${bd}`, background: bg, borderRadius: 8, padding: "8px 6px", textAlign: "center", minHeight: 86 }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: cls === "err" ? "#dc2626" : cls === "ok" ? "#16a34a" : "#94a3b8", fontFamily: "Consolas,monospace" }}>{x.panel_pos}</div>
                  <div style={{ fontFamily: "Consolas,monospace", fontSize: 11, color: "#64748b", wordBreak: "break-all" }}>{x.sn}</div>
                  <div title={x.last_station ? `${x.last_station} ${x.last_result} ${x.last_time}` : undefined}
                    style={{ fontSize: 10.5, color: x.last_station ? "#15803d" : x.aoi_time ? "#475569" : "#b91c1c" }}>
                    {lastLine}
                  </div>
                  {x.left_h !== null && (
                    <div style={{ fontSize: 10.5, fontFamily: "Consolas,monospace", fontWeight: x.left_h < 0 || x.left_h <= 24 ? 700 : 400, color: x.left_h < 0 ? "#b91c1c" : x.left_h <= 24 ? "#b45309" : "#15803d" }}>
                      {x.left_h < 0 ? `${t("w20.dip.overH", locale)} ${Math.abs(x.left_h)}h` : `${t("w20.dip.leftH", locale)} ${x.left_h}h`}
                    </div>
                  )}
                  <div style={{ fontSize: 11.5, fontWeight: 600, color: cls === "ok" ? "#15803d" : cls === "err" ? "#b91c1c" : "#94a3b8" }}>
                    {x.passed ? `✓ ${t("w20.dip.curPassed", locale)} ${hhmm(x.pass_time)}` : x.result === "NG" ? "NG" : t("w20.dip.curWait", locale)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 按小时产量（今天，全产线口径 —— 服务端 /exec/hourly 不按工单/工位过滤） */}
      <div style={box}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
          <b style={{ fontSize: 15 }}>{t("w20.dip.hourly", locale)}</b>
          <span style={muted}>{hourly ? `${hourly.day} · ${t("w20.dip.allLines", locale)}` : ""}</span>
          <span style={{ flex: 1 }} />
          {hourly && hourlyTotal > 0 && (
            <span style={{ fontSize: 13 }}>
              <b style={{ fontSize: 16 }}>{hourlyTotal}</b> {t("w20.dip.sumQty", locale)}
              {peak && peak.total > 0 && <span style={{ marginLeft: 10, color: "#64748b" }}>{t("w20.dip.peak", locale)} {peak.hour}:00·{peak.total}</span>}
              {Number(hourly.total?.ng_qty || 0) > 0 && <span style={{ marginLeft: 10, color: "#b91c1c" }}>NG {hourly.total.ng_qty}</span>}
              {hourly.total?.yield !== undefined && <span style={{ marginLeft: 10, color: "#15803d" }}>{t("w20.dip.yield", locale)} {hourly.total.yield}%</span>}
            </span>
          )}
        </div>
        {!hourly || hourlyTotal === 0 ? (
          <div style={{ ...muted, padding: "10px 0" }}>{t("w20.dip.hourlyEmpty", locale)}</div>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 130 }}>
              {(hourly.hours || []).map(h => {
                const okH = Math.round((Number(h.ok_qty || 0) / hmax) * 100);
                const ngH = Math.round((Number(h.ng_qty || 0) / hmax) * 100);
                return (
                  <div key={h.hour} title={`${h.hour}:00 · OK ${h.ok_qty} NG ${h.ng_qty}`}
                    style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end" }}>
                    {h.total > 0 && <span style={{ fontSize: 9, color: "#475569" }}>{h.total}</span>}
                    {ngH > 0 && <div style={{ width: "72%", height: ngH, background: "#ef4444" }} />}
                    <div style={{ width: "72%", height: okH, background: "#3b82f6", borderRadius: "2px 2px 0 0" }} />
                    <div style={{ fontSize: 8, color: "#94a3b8", marginTop: 2 }}>{h.hour}</div>
                  </div>
                );
              })}
            </div>
            {(hourly.by_station || []).length > 0 && (
              <div style={{ ...muted, marginTop: 6 }}>
                {t("w20.dip.byStation", locale)}：
                {hourly.by_station.slice(0, 6).map(s => `${s.station_code} ${s.total}`).join(" · ")}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// exec.tracebind —— SN 绑定 / 全链路追溯：查绑定树 + 待维修汇总 + 批量导入
// 源 L12440。后端 /smt/sn_trace 只回 bind（无 extra 段），物料/钢网明细到对应
// 管控页看；待维修侧栏走 /repair/pending-summary。
// ════════════════════════════════════════════════════════════════════════════

type BindRow = Record<string, string | null | undefined>;
interface TraceResp { success?: boolean; msg?: string; bind?: BindRow }
interface PendingSumRow { station_code: string; qty: number; first_at: string; last_at: string; defects: string; line_code: string }
interface PendingSummary { rows: PendingSumRow[]; total: number; line_code?: string }

const BIND_FIELDS: Array<[key: string, labelKey: string]> = [
  ["mo_no", "mo"], ["model", "w20.trace.model"], ["machine_no", "w20.trace.machine"],
  ["channel", "w20.trace.channel"], ["feeder_no", "w20.trace.feeder"],
  ["material_sn", "w20.trace.materialSn"], ["stencil_sn", "w20.trace.stencilSn"],
  ["paste_sn", "w20.trace.pasteSn"], ["pcb_reel_sn", "w20.trace.pcbSn"],
  ["operator", "w20.trace.operator"], ["prod_time", "w20.trace.prodTime"],
  ["source", "w20.trace.source"],
];

const IMPORT_PLACEHOLDER = '[{"sn":"5GAH07233A","mo_no":"ASM-260905-001-01","model":"EPS18R1G-36 PCB2","machine_no":"NPM-01","channel":"1","feeder_no":"FD08001","material_sn":"RSN002","stencil_sn":"ST-001-V01","paste_sn":"SOLDER-001","pcb_reel_sn":"PCB-001","operator":"ruijing","prod_time":"2026-10-17 12:00:00"}]';

export function TraceBindView({ locale }: { locale: Locale }) {
  const [sn, setSn] = useState("");
  const [bind, setBind] = useState<BindRow | null>(null);
  const [tracedSn, setTracedSn] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [summary, setSummary] = useState<PendingSummary | null>(null);
  const snRef = useRef<HTMLInputElement>(null);

  const loadSummary = useCallback(async () => {
    const [d] = await call(() => mesrjApi.get<PendingSummary>("/repair/pending-summary"));
    if (d) setSummary(d);
  }, []);
  useEffect(() => { void loadSummary(); }, [loadSummary]);
  useEffect(() => { snRef.current?.focus(); }, []);

  const doTrace = async () => {
    const code = sn.trim();
    if (!code) { setErr(t("w20.trace.snRequired", locale)); return; }
    setBusy(true); setErr(""); setMsg(""); setNote(""); setBind(null);
    const [d, e] = await call(() => mesrjApi.get<TraceResp>("/smt/sn_trace", { sn: code }));
    setBusy(false);
    if (e) { setErr(e); return; }
    if (!d || d.success !== true || !d.bind) { setNote(d?.msg || t("no_data", locale)); setTracedSn(code); return; }
    setBind(d.bind); setTracedSn(code);
  };

  const doImport = async () => {
    const raw = text.trim();
    if (!raw) { setErr(t("w20.trace.needJson", locale)); return; }
    let arr: unknown;
    try { arr = JSON.parse(raw); }
    catch (ex) { setErr(`${t("w20.trace.jsonErr", locale)}：${ex instanceof Error ? ex.message : String(ex)}`); return; }
    if (!Array.isArray(arr)) { setErr(t("w20.trace.needArray", locale)); return; }
    setBusy(true); setErr(""); setMsg("");
    const [d, e] = await call(() => mesrjApi.post<{ success?: boolean; msg?: string }>("/smt/sn_import", { rows: arr }));
    setBusy(false);
    if (e) { setErr(e); return; }
    if (d && d.success === false) { setErr(d.msg || t("common.loadFail", locale)); return; }
    setMsg(d?.msg || t("save", locale)); setText("");
  };

  return (
    <div>
      <div style={{ ...box, display: "flex", gap: 10, alignItems: "flex-end" }}>
        <div>
          <div style={muted}>{t("w20.trace.snLabel", locale)}</div>
          <input ref={snRef} value={sn} autoComplete="off"
            onChange={e => setSn(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") void doTrace(); }}
            placeholder={t("w20.trace.snPh", locale)}
            style={{ ...inp, width: 300, height: 38, fontFamily: "Consolas,monospace", boxSizing: "border-box" }} />
        </div>
        <button disabled={busy} onClick={() => void doTrace()} style={{ height: 38 }}>{t("w20.trace.query", locale)}</button>
        <span style={{ flex: 1 }} />
        <button onClick={() => void loadSummary()}>{t("refresh", locale)}</button>
      </div>
      <Err msg={err} /><Ok msg={msg} />

      {/* 追溯结果 */}
      {note && !bind && (
        <div style={{ ...box, padding: 16, background: "#FEF2F2", border: "1px solid #FCA5A5", color: "#991B1B", fontSize: 13.5 }}>
          🔍 <b style={{ fontFamily: "Consolas,monospace" }}>{tracedSn}</b>　{note}
        </div>
      )}
      {bind && (
        <div style={{ ...box, padding: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#0f172a", marginBottom: 12 }}>
            🔍 <span style={{ fontFamily: "Consolas,monospace" }}>{tracedSn}</span>
            <span style={{ fontSize: 12, color: "#64748b", fontWeight: 400, marginLeft: 10 }}>{t("w20.trace.result", locale)}</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "8px 20px" }}>
            {BIND_FIELDS.map(([key, labelKey]) => (
              <div key={key} style={{ padding: "8px 12px", background: "#f8fafc", borderRadius: 8 }}>
                <div style={muted}>{t(labelKey, locale)}</div>
                <div style={{ fontFamily: "Consolas,monospace", fontSize: 13, fontWeight: 600, wordBreak: "break-all" }}>
                  {String(bind[key] ?? "") || "—"}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        {/* 批量导入绑定（源屏的 JSON 导入，反向绑定 AOI 数据入口） */}
        <div style={{ ...box, flex: "2 1 420px", minWidth: 360 }}>
          <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 14 }}>{t("w20.trace.batch", locale)}</div>
          <div style={{ ...muted, marginBottom: 6 }}>
            {t("w20.trace.fields", locale)}：sn(★) mo_no model machine_no channel feeder_no material_sn stencil_sn paste_sn pcb_reel_sn operator prod_time
          </div>
          <textarea value={text} onChange={e => setText(e.target.value)} rows={6} placeholder={IMPORT_PLACEHOLDER}
            style={{ width: "100%", border: "1px solid #cbd5e1", borderRadius: 8, padding: 10, fontFamily: "Consolas,monospace", fontSize: 12, boxSizing: "border-box" }} />
          <button disabled={busy} onClick={() => void doImport()} style={{ marginTop: 8 }}>{t("w20.trace.import", locale)}</button>
        </div>

        {/* 待维修汇总（repair/pending-summary：待处理缺陷按工位聚合） */}
        <div style={{ ...box, flex: "1 1 280px", minWidth: 280 }}>
          <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
            <b style={{ fontSize: 14 }}>{t("w20.trace.repairPanel", locale)}</b>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 12, color: "#64748b" }}>{t("common.total", locale)} <b style={{ color: "#0f172a" }}>{Number(summary?.total ?? 0)}</b></span>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead><tr>
              {[t("sn.field.station_code", locale), t("w20.trace.qty", locale), t("w20.trace.lastAt", locale), t("w20.trace.defects", locale)].map(h => (
                <th key={h} style={{ padding: "5px 6px", borderBottom: "1px solid var(--border, #e2e8f0)", textAlign: "left" }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {(summary?.rows || []).map(r => (
                <tr key={r.station_code} style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <td style={{ padding: "5px 6px", fontFamily: "monospace" }}>{r.station_code}</td>
                  <td style={{ padding: "5px 6px", fontWeight: 700, color: Number(r.qty) > 0 ? "#b91c1c" : "#0f172a" }}>{Number(r.qty)}</td>
                  <td style={{ padding: "5px 6px", color: "#64748b" }}>{String(r.last_at || "").slice(5, 16).replace("T", " ")}</td>
                  <td style={{ padding: "5px 6px", color: "#64748b" }}>{r.defects || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!(summary?.rows || []).length && <div style={{ ...muted, paddingTop: 6 }}>{t("common.noData", locale)}</div>}
        </div>
      </div>
    </div>
  );
}
