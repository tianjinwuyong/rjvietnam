// MES-ruijing W11 前端 —— 外箱绑码（装箱站）
// 后端路由（services/api/src/routes/mesrj.js，源 api/pack.py 21 路由）：
//   GET  /pack/init                初始化（箱容/打印模板/编码规则/打印代理状态）
//   POST /pack/agent/ping          打印代理心跳
//   GET  /pack/rule                编码规则与「下一个编码」预览
//   GET  /pack/context             当前工单装箱上下文（未完成箱/已装箱数）
//   POST /pack/box/start           开箱
//   POST /pack/bind                扫码装箱（装满自动封箱 + 生成外箱码 + 打印）
//   POST /pack/close               尾数封箱
//   POST /pack/box/tpl             换打印模板
//   POST /pack/unbind              解绑
//   POST /pack/box/cancel          作废空箱
//   POST /pack/print               补打 / 手动打印
//   GET  /pack/jobs                打印任务队列
//   POST /pack/jobs/:job_no/done   打印任务回执
//   GET  /pack/preview/info        标签预览信息（槽位数/页数）
//   GET  /pack/preview             标签预览图（SVG data URI）
//   GET  /pack/box/list            箱列表
//   GET  /pack/box/:box_no         箱详情
//   GET  /pack/tpl/files           打印电脑本机 .btw 清单
//   GET  /pack/tpl/browse          浏览磁盘目录挑模板
//   POST /pack/tpl/quick           「浏览…」选中的模板自动登记
//   GET  /pack/stats               产能带（计划/已装箱/达成率/小时产量）
import { useCallback, useEffect, useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { mesrjApi, mesrjMsg, MesrjApiError } from "./api";
import { t } from "./i18n";

const box = { border: "1px solid var(--border, #e2e8f0)", borderRadius: 10, padding: 14, marginBottom: 14 } as const;
const inp = { padding: "6px 8px", marginRight: 6, border: "1px solid var(--border, #e2e8f0)", borderRadius: 6 } as const;
const btn = { padding: "6px 12px", marginRight: 6, borderRadius: 6, border: "1px solid var(--border, #e2e8f0)", background: "#fff", cursor: "pointer" } as const;
const btnPrim = { ...btn, background: "#2563eb", color: "#fff", borderColor: "#2563eb" } as const;
const btnWarn = { ...btn, background: "#b45309", color: "#fff", borderColor: "#b45309" } as const;

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

// ── 类型 ────────────────────────────────────────────────────────────────────
interface BoxRow {
  id: number; box_no: string; mo_no: string; po_no: string; product_code: string;
  qty: number; capacity: number; status: string; line_code: string; pallet_no: string;
  tpl_code: string; print_times: number; created_by: string; created_at: string;
  sn_count?: number; sn_preview?: string[]; sns?: string[];
  sn_detail?: { sn: string; q: string }[]; ng_count?: number;
}
interface PackCtx { open_box: BoxRow | null; mo_boxed_sn: number; mo_closed_boxes: number; }
interface PackStats {
  empty?: boolean; mo_no: string; plan_qty: number; packed_qty: number; rest_qty: number;
  box_qty: number; cur_qty: number; cur_cap: number; rate: number;
  today_boxes: number; today_qty: number; hourly: { h: string; n: number }[];
}
interface RulePreview {
  day_code: string; date: string; next_carton_no: string; next_pallet_no: string;
  today_cartons: number; today_pallets: number;
  rule: { machine_model: string; wireline_sku: string; consumer_sku: string; carton_qty: number };
}
interface PackInit {
  default_capacity: number;
  templates: { tpl_code: string; tpl_name: string; tpl_type: string; file_name: string; exists?: boolean }[];
  print_agent: { alive: boolean; last_seen: string; printer: string; pending: number };
  tpl_dir: string;
}
interface MoOpt { mo_no: string; product_code: string; status: string; line_code: string; plan_qty: number; out_qty: number; }

export function PackView({ locale }: { locale: Locale }) {
  const [init, setInit] = useState<PackInit | null>(null);
  const [mos, setMos] = useState<MoOpt[]>([]);
  const [mo, setMo] = useState("");
  const [line, setLine] = useState("");
  const [stats, setStats] = useState<PackStats | null>(null);
  const [ctx, setCtx] = useState<PackCtx | null>(null);
  const [rule, setRule] = useState<RulePreview | null>(null);
  const [boxes, setBoxes] = useState<BoxRow[]>([]);
  const [sn, setSn] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [tplCode, setTplCode] = useState("");
  const [pv, setPv] = useState<{ img: string; pages: number; page: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const loadInit = useCallback(async () => {
    const [d, e] = await call(() => mesrjApi.get<PackInit>("/pack/init"));
    if (e || !d) { setErr(e || "未返回数据"); return; }
    setInit(d);
    if (d.templates.length && !tplCode) {
      const first = d.templates.find(x => x.tpl_type === "外箱标签") || d.templates[0];
      setTplCode(first.tpl_code);
    }
  }, [tplCode]);

  const loadMos = useCallback(async () => {
    const [d, e] = await call(() => mesrjApi.get<{ rows: MoOpt[] }>("/ord/mo", { size: 300 }));
    if (e || !d) { setErr(e || "未返回数据"); return; }
    const live = (d.rows || []).filter(x =>
      ["生产中", "已下达", "已排产", "待排产"].includes(String(x.status || "")));
    setMos(live);
  }, []);

  const loadCtx = useCallback(async () => {
    if (!mo) { setCtx(null); setStats(null); setRule(null); return; }
    const [c, s, r] = await Promise.all([
      call(() => mesrjApi.get<PackCtx>("/pack/context", { mo_no: mo, line_code: line })),
      call(() => mesrjApi.get<PackStats>("/pack/stats", { mo_no: mo })),
      call(() => mesrjApi.get<{ preview: RulePreview | null }>("/pack/rule", { mo_no: mo })),
    ]);
    if (c[1]) setErr(c[1]); else setCtx(c[0]);
    if (s[1]) setErr(s[1]); else setStats(s[0]);
    setRule(r[0] && r[0].preview ? r[0].preview : null);
  }, [mo, line]);

  const loadBoxes = useCallback(async () => {
    const [d, e] = await call(() => mesrjApi.get<{ rows: BoxRow[] }>("/pack/box/list",
      { mo_no: mo, size: 50 }));
    if (e || !d) return;
    setBoxes(d.rows || []);
  }, [mo]);

  useEffect(() => { void loadInit(); void loadMos(); }, [loadInit, loadMos]);
  useEffect(() => { void loadCtx(); void loadBoxes(); }, [loadCtx, loadBoxes]);

  const bind = async () => {
    const code = sn.trim();
    if (!code) return;
    setBusy(true); setErr(""); setMsg("");
    const [d, e] = await call(() => mesrjMsg.post<{
      box: BoxRow | null; auto_closed: boolean; final_box_no: string;
      print_job: string; print_warn: string;
    }>("/pack/bind", { sn: code, mo_no: mo, line_code: line, tpl_code: tplCode }));
    setBusy(false);
    if (e || !d) { setErr(e || "未返回数据"); return; }
    setMsg(d.msg || "");
    setSn("");
    void loadCtx(); void loadBoxes();
  };

  const act = async (path: string, body: Record<string, unknown>, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true); setErr(""); setMsg("");
    const [d, e] = await call(() => mesrjMsg.post(path, body));
    setBusy(false);
    if (e || !d) { setErr(e || "未返回数据"); return; }
    setMsg(d.msg || "");
    void loadCtx(); void loadBoxes();
  };

  const openBox = ctx?.open_box || null;
  const snGrid = openBox?.sn_detail || [];

  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 10 }}>{t("menu.exec.pack", locale)}</div>
      <Ok msg={msg} /><Err msg={err} />

      {/* 产能带 */}
      {stats && !stats.empty && (
        <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
          {[
            [t("pack.plan", locale), stats.plan_qty, "#0f172a"],
            [t("pack.packed", locale), stats.packed_qty, "#15803d"],
            [t("pack.rest", locale), stats.rest_qty, "#b45309"],
            [`${t("pack.rate", locale)} %`, stats.rate, "#2563eb"],
            [t("pack.today_boxes", locale), stats.today_boxes, "#0f172a"],
            [t("pack.today_qty", locale), stats.today_qty, "#0f172a"],
          ].map(([k, v, c]) => (
            <div key={String(k)} style={{ ...box, marginBottom: 0, flex: 1, minWidth: 110 }}>
              <div style={{ fontSize: 12, color: "#64748b" }}>{k}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: String(c) }}>{String(v)}</div>
            </div>
          ))}
          <div style={{ ...box, marginBottom: 0, flex: 2, minWidth: 260 }}>
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>{t("pack.hourly", locale)}</div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 46 }}>
              {(stats.hourly || []).map(h => {
                const max = Math.max(1, ...(stats.hourly || []).map(x => x.n));
                return (
                  <div key={h.h} title={`${h.h}:00 ${h.n}`}
                    style={{ flex: 1, textAlign: "center" }}>
                    <div style={{ height: Math.round((h.n / max) * 36), background: h.n ? "#2563eb" : "#e2e8f0", borderRadius: 2 }} />
                    <div style={{ fontSize: 9, color: "#94a3b8" }}>{h.h}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* 工单 / 产线 / 规则 */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
        <select value={mo} onChange={ev => setMo(ev.target.value)} style={{ ...inp, minWidth: 280 }}>
          <option value="">{t("pack.mo_no", locale)}</option>
          {mos.map(m => (
            <option key={m.mo_no} value={m.mo_no}>
              {`${m.mo_no} · ${m.product_code} · ${m.status} · ${m.out_qty}/${m.plan_qty}`}
            </option>
          ))}
        </select>
        <input {...inp} placeholder={t("pack.line_code", locale)} value={line}
          onChange={ev => setLine(ev.target.value)} />
        <select value={tplCode} onChange={ev => setTplCode(ev.target.value)} style={inp}>
          <option value="">{t("pack.template", locale)}</option>
          {(init?.templates || []).map(tp => (
            <option key={tp.tpl_code} value={tp.tpl_code}>
              {`${tp.tpl_name}${tp.exists === false ? "（缺文件）" : ""}`}
            </option>
          ))}
        </select>
        <button {...btn} onClick={() => void loadInit()}>{t("common.refresh", locale)}</button>
      </div>

      {rule && (
        <div style={{ ...box, fontSize: 13, display: "flex", gap: 18, flexWrap: "wrap" }}>
          <span>{`${t("pack.next_carton", locale)}: `}<b>{rule.next_carton_no}</b></span>
          <span>{`${t("pack.next_pallet", locale)}: `}<b>{rule.next_pallet_no}</b></span>
          <span>{`${t("pack.day_code", locale)}: `}<b>{rule.day_code}</b></span>
          <span>{`${t("pack.machine_model", locale)}: `}<b>{rule.rule?.machine_model || "—"}</b></span>
        </div>
      )}

      {/* 扫码装箱 */}
      <div style={{ ...box }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
          <input
            style={{ ...inp, width: 280, fontSize: 15 }}
            placeholder={mo ? t("pack.scan_sn", locale) : t("pack.mo_no", locale)}
            value={sn}
            disabled={!mo}
            onChange={ev => setSn(ev.target.value)}
            onKeyDown={ev => { if (ev.key === "Enter") void bind(); }}
          />
          <button {...btnPrim} disabled={!mo || busy || !sn.trim()} onClick={() => void bind()}>
            {t("pack.bind", locale)}
          </button>
          {openBox && (
            <>
              <button {...btnWarn} disabled={busy} onClick={() => void act("/pack/close",
                { box_no: openBox.box_no, force: true },
                `${t("pack.close", locale)}：${openBox.qty}/${openBox.capacity}？`)}>
                {t("pack.close", locale)}
              </button>
              <button {...btn} disabled={busy} onClick={() => void act("/pack/box/cancel",
                { box_no: openBox.box_no })}>{t("pack.cancel", locale)}</button>
              <button {...btn} disabled={busy} onClick={() => {
                const code = window.prompt(t("pack.sn", locale), "");
                if (!code) return;
                void act("/pack/unbind", { box_no: openBox.box_no, sn: code, reason: "" });
              }}>{t("pack.unbind", locale)}</button>
              <button {...btn} disabled={busy} onClick={async () => {
                const [d, e] = await call(() => mesrjApi.get<{ img: string; pages: number; page: number }>(
                  "/pack/preview", { box_no: openBox.box_no, page: 1 }));
                if (e || !d) { setErr(e || "未返回数据"); return; }
                setPv(d);
              }}>{t("pack.preview", locale)}</button>
            </>
          )}
        </div>

        {openBox ? (
          <div>
            <div style={{ fontSize: 13, marginBottom: 6 }}>
              {`${t("pack.box_no", locale)}: ${openBox.box_no} · ${t("pack.qty", locale)}: ${openBox.qty}/${openBox.capacity}` +
                (openBox.ng_count ? ` · ${t("pack.ng", locale)}: ${openBox.ng_count}` : "")}
              <span style={{ marginLeft: 12, color: "#64748b" }}>{t("pack.sn_grid", locale)}</span>
            </div>
            <div style={{ height: 10, background: "#e2e8f0", borderRadius: 5, overflow: "hidden", marginBottom: 8 }}>
              <div style={{ height: "100%", width: `${Math.min(100, (openBox.qty / Math.max(1, openBox.capacity)) * 100)}%`, background: "#2563eb" }} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(16, 1fr)", gap: 3 }}>
              {Array.from({ length: Math.max(openBox.capacity, 1) }).map((_, i) => {
                const cell = snGrid[i];
                return (
                  <div key={i} title={cell ? `${cell.sn} ${cell.q}` : ""}
                    style={{
                      height: 22, borderRadius: 3, fontSize: 9, lineHeight: "22px", textAlign: "center",
                      background: !cell ? "#f1f5f9" : (cell.q === "NG" ? "#dc2626" : "#16a34a"),
                      color: cell ? "#fff" : "#cbd5e1", overflow: "hidden",
                    }}>
                    {cell ? (cell.q === "NG" ? "NG" : "✓") : ""}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 13, color: "#64748b" }}>
            {mo ? t("pack.no_box", locale) : t("pack.mo_no", locale)}
          </div>
        )}
      </div>

      {/* 标签预览 */}
      {pv && (
        <div style={box}>
          <div style={{ fontSize: 13, marginBottom: 6 }}>
            {`${t("pack.preview", locale)} — ${t("pack.page", locale)} ${pv.page}/${pv.pages}`}
          </div>
          <img src={pv.img} alt="carton label" style={{ maxWidth: "100%", border: "1px solid var(--border, #e2e8f0)" }} />
        </div>
      )}

      {/* 箱列表 */}
      <div style={box}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>{t("pack.box_list", locale)}</div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>
            <th style={{ padding: "8px 6px", textAlign: "left", borderBottom: "2px solid var(--border, #e2e8f0)", fontSize: 13 }}>{t("pack.box_no", locale)}</th>
            <th style={{ padding: "8px 6px", textAlign: "left", borderBottom: "2px solid var(--border, #e2e8f0)", fontSize: 13 }}>{t("pack.mo_no", locale)}</th>
            <th style={{ padding: "8px 6px", textAlign: "left", borderBottom: "2px solid var(--border, #e2e8f0)", fontSize: 13 }}>{t("pack.line_code", locale)}</th>
            <th style={{ padding: "8px 6px", textAlign: "left", borderBottom: "2px solid var(--border, #e2e8f0)", fontSize: 13 }}>{t("pack.qty", locale)}</th>
            <th style={{ padding: "8px 6px", textAlign: "left", borderBottom: "2px solid var(--border, #e2e8f0)", fontSize: 13 }}>{t("pack.status", locale)}</th>
            <th style={{ padding: "8px 6px", textAlign: "left", borderBottom: "2px solid var(--border, #e2e8f0)", fontSize: 13 }}>{t("pack.print_times", locale)}</th>
            <th style={{ padding: "8px 6px", textAlign: "left", borderBottom: "2px solid var(--border, #e2e8f0)", fontSize: 13 }}>{t("pack.reprint", locale)}</th>
          </tr></thead>
          <tbody>
            {boxes.map(b => (
              <tr key={b.id} style={{ borderBottom: "1px solid var(--border, #e2e8f0)" }}>
                <td style={{ padding: "7px 6px", fontSize: 13, fontWeight: 600 }}>{b.box_no}</td>
                <td style={{ padding: "7px 6px", fontSize: 13 }}>{b.mo_no}</td>
                <td style={{ padding: "7px 6px", fontSize: 13 }}>{b.line_code || "—"}</td>
                <td style={{ padding: "7px 6px", fontSize: 13 }}>{`${b.qty}/${b.capacity}`}</td>
                <td style={{ padding: "7px 6px", fontSize: 13 }}>{t(`status.${b.status}`, locale)}</td>
                <td style={{ padding: "7px 6px", fontSize: 13 }}>{b.print_times}</td>
                <td style={{ padding: "7px 6px", fontSize: 13 }}>
                  {b.status === "已封箱" && (
                    <button {...btn} disabled={busy} onClick={() => void act("/pack/print",
                      { box_no: b.box_no, tpl_code: tplCode, reprint: true })}>
                      {t("pack.reprint", locale)}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!boxes.length && (
              <tr><td colSpan={7} style={{ padding: 10, fontSize: 13, color: "#64748b" }}>{t("common.noData", locale)}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
