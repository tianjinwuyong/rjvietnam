// MES-ruijing W17 前端 —— ruijing-mes 残余 10 屏嫁接（源 web/pages.js exec.ultra /
// exec.ultraparam / exec.teardown / exec.agingctl / exec.lasercheck / prod.shelflife /
// cfg.calib / md.fixture / report.stboard / sys.dept）。
// 后端全部已存在：ultra.js / aging.js / laser-readback.js / shelf-life.js / calib.js /
// fixture.js / gap-routes.js(station-board) / dept.js / bind(-routes).js。
// 标准：docs/grafting-standards.md §7（前端镜像 + 三语）；接线见 index.tsx renderView。
import { useCallback, useEffect, useRef, useState, isValidElement } from "react";
import type { ReactNode } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { mesrjApi } from "./api";
import { t } from "./i18n";
import { API_BASE, authStorage } from "../api/client";

const box = { border: "1px solid var(--border, #e2e8f0)", borderRadius: 10, padding: 14, marginBottom: 14 } as const;
const inp = { padding: "6px 8px", marginRight: 6 } as const;
const LV_COLOR: Record<string, string> = {
  EXPIRED: "#B91C1C", D30: "#B91C1C", D60: "#B45309", WARN: "#B45309",
  OK: "#0F766E", NONE: "#94A3B8", NOLIMIT: "#64748B", RUNNING: "#2563EB",
  READY: "#B45309", FAIL: "#B91C1C",
};

function Err({ msg }: { msg: string }) {
  if (!msg) return null;
  return <div style={{ color: "#b91c1c", padding: "6px 0", fontSize: 13, whiteSpace: "pre-wrap" }}>{msg}</div>;
}
function Ok({ msg }: { msg: string }) {
  if (!msg) return null;
  return <div style={{ color: "#15803d", padding: "6px 0", fontSize: 13, whiteSpace: "pre-wrap" }}>{msg}</div>;
}
function cellVal(v: unknown): ReactNode {
  if (v === null || v === undefined || v === "") return "";
  if (isValidElement(v)) return v;
  return String(v);
}
function Table({ header, rows }: { header: [string, string][]; rows: Record<string, unknown>[] }) {
  if (!rows.length) return <div style={{ color: "#94a3b8", fontSize: 13 }}>No data</div>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead><tr>
          {header.map(([k, label]) => (
            <th key={k} style={{ padding: "6px 8px", borderBottom: "1px solid var(--border, #e2e8f0)", textAlign: "left" }}>{label}</th>
          ))}
        </tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderBottom: "1px solid #f1f5f9" }}>
              {header.map(([k]) => <td key={k} style={{ padding: "5px 8px" }}>{cellVal(r[k])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function Kpi({ items }: { items: Array<[string, number | string, string?]> }) {
  return (
    <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
      {items.map(([label, v, color]) => (
        <span key={label} style={{ fontSize: 13, color: color || "#334155" }}>
          {label} <b style={{ fontSize: 15 }}>{v}</b>
        </span>
      ))}
    </div>
  );
}
function lvTag(locale: Locale, level: string) {
  return <span style={{ color: LV_COLOR[level] || "#334155", fontWeight: 600 }}>{t(`w17.lv.${level}`, locale)}</span>;
}
async function downloadXlsx(path: string, filename: string) {
  const token = authStorage.getToken();
  const resp = await fetch(`${API_BASE}/api/mesrj${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
function fileToB64(f: File): Promise<string> {
  // 本仓 tsconfig lib < ES2024：Promise.withResolvers 不可用，只能 executor 形式
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || "").split(",")[1] || "");
    r.onerror = () => reject(new Error("read failed"));
    r.readAsDataURL(f);
  });
}

// ── 通用台账页（校准 / 治具 共用骨架：KPI + 过滤 + 表格 + 编辑弹窗 + 导入/模板）──
interface LedgerCfg {
  listPath: string; savePath: string; deletePath: string; importPath: string; templatePath: string;
  cntKeys: Array<[string, string]>;         // [row key, kpi i18n suffix]
  levelFilter: Array<[string, string]>;      // [value, i18n suffix]
  columns: string[];                          // data keys in table order
  formFields: Array<{ k: string; type?: string; opts?: string[] }>;
  kwPlaceholderKey: string;
  extraFilters?: Array<{ key: string; optsKey: string; labelSuffix: string }>;
  titleSuffix: string;                        // i18n suffix for page title
}

function LedgerPage({ locale, cfg }: { locale: Locale; cfg: LedgerCfg }) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [cnt, setCnt] = useState<Record<string, number>>({});
  const [opts, setOpts] = useState<Record<string, string[]>>({});
  const [kw, setKw] = useState(""); const [level, setLevel] = useState("");
  const [extra, setExtra] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<Record<string, string> | null>(null);
  const [err, setErr] = useState(""); const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setErr("");
    try {
      const q: Record<string, unknown> = { keyword: kw, level };
      for (const f of cfg.extraFilters || []) q[f.key] = extra[f.key] || "";
      const d = await mesrjApi.get<{ rows: Record<string, unknown>[]; cnt: Record<string, number> } & Record<string, string[]>>(cfg.listPath, q);
      setRows(d.rows || []); setCnt(d.cnt || {});
      const o: Record<string, string[]> = {};
      for (const f of cfg.extraFilters || []) o[f.optsKey] = (d as Record<string, unknown>)[f.optsKey] as string[] || [];
      setOpts(o);
    } catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
  }, [cfg, kw, level, extra]);
  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    if (!editing) return;
    setErr(""); setMsg("");
    try {
      await mesrjApi.post(cfg.savePath, editing);
      setMsg(t("w17.saved", locale)); setEditing(null); void load();
    } catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
  };
  const del = async (id: unknown) => {
    if (!window.confirm(t("w17.confirm_delete", locale))) return;
    setErr(""); setMsg("");
    try { await mesrjApi.post(cfg.deletePath, { id }); void load(); }
    catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
  };
  const importFile = async (f: File | null) => {
    if (!f) return;
    setErr(""); setMsg("");
    try {
      const content_base64 = await fileToB64(f);
      const r = await mesrjApi.post<{ added?: number; updated?: number; skipped?: number; errors?: string[] }>(cfg.importPath, { file_name: f.name, content_base64 });
      const errs = r.errors || [];
      setMsg(`${t("w17.imported", locale)}: +${r.added ?? 0} ~${r.updated ?? 0} -${r.skipped ?? 0}${errs.length ? ` | ${errs.slice(0, 3).join("; ")}` : ""}`);
      void load();
    } catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
  };

  const header: [string, string][] = [
    ...cfg.columns.map(k => [k, t(`w17.f.${cfg.titleSuffix}.${k}`, locale)] as [string, string]),
    ["__level", t("w17.col.level", locale)],
    ["__act", t("w17.col.actions", locale)],
  ];
  return (
    <div>
      <div style={{ ...box, fontSize: 14, fontWeight: 600 }}>{t(`menu.${cfg.titleSuffix === "calib" ? "cfg.calib" : "md.fixture"}`, locale)}</div>
      <div style={box}>
        <Kpi items={cfg.cntKeys.map(([k, s]) => [t(`w17.kpi.${s}`, locale), cnt[k] ?? 0, LV_COLOR[k.toUpperCase()] || undefined])} />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10, alignItems: "center" }}>
          <input value={kw} onChange={e => setKw(e.target.value)} placeholder={t(cfg.kwPlaceholderKey, locale)} style={{ ...inp, width: 220 }} />
          <select value={level} onChange={e => setLevel(e.target.value)} style={inp}>
            <option value="">{t("w17.all", locale)}</option>
            {cfg.levelFilter.map(([v, s]) => <option key={v} value={v}>{t(`w17.lv.${s}`, locale)}</option>)}
          </select>
          {(cfg.extraFilters || []).map(f => (
            <select key={f.key} value={extra[f.key] || ""} onChange={e => setExtra(x => ({ ...x, [f.key]: e.target.value }))} style={inp}>
              <option value="">{t(`w17.f.calib.${f.labelSuffix}`, locale)}</option>
              {(opts[f.optsKey] || []).map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          ))}
          <button onClick={() => void load()}>{t("search", locale)}</button>
          <span style={{ flex: 1 }} />
          <button onClick={() => setEditing(Object.fromEntries(cfg.formFields.map(x => [x.k, ""])))}>＋ {t("w17.add", locale)}</button>
          <label style={{ ...inp, cursor: "pointer", border: "1px solid #cbd5e1", borderRadius: 6 }}>
            {t("w17.import_xlsx", locale)}
            <input type="file" accept=".xlsx" style={{ display: "none" }} onChange={e => void importFile(e.target.files?.[0] || null)} />
          </label>
          <button onClick={() => void downloadXlsx(cfg.templatePath, "template.xlsx").catch(ex => setErr(String(ex)))}>{t("w17.template", locale)}</button>
        </div>
      </div>
      <Err msg={err} /><Ok msg={msg} />
      <div style={box}>
        <Table header={header} rows={rows.map(r => ({
          ...r,
          __level: r.level ? lvTag(locale, String(r.level)) : "",
          __act: (
            <span>
              <button style={{ fontSize: 11, marginRight: 4 }} onClick={() => setEditing(Object.fromEntries(cfg.formFields.map(x => [x.k, String(r[x.k] ?? "")])))}>✎</button>
              <button style={{ fontSize: 11 }} onClick={() => void del(r.id)}>✕</button>
            </span>
          ),
        }))} />
      </div>
      {editing && (
        <div style={{ ...box, background: "#f8fafc" }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>{editing.id ? t("w17.edit", locale) : t("w17.add", locale)}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(230px,1fr))", gap: 8 }}>
            {cfg.formFields.map(f => (
              <label key={f.k} style={{ fontSize: 12 }}>
                {t(`w17.f.${cfg.titleSuffix}.${f.k}`, locale)}
                {f.opts ? (
                  <select value={editing[f.k] ?? ""} onChange={e => setEditing(x => ({ ...(x || {}), [f.k]: e.target.value }))} style={{ display: "block", width: "100%", marginTop: 2 }}>
                    <option value="" />{f.opts.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <input value={editing[f.k] ?? ""} type={f.type || "text"} onChange={e => setEditing(x => ({ ...(x || {}), [f.k]: e.target.value }))} style={{ display: "block", width: "100%", marginTop: 2, padding: "4px 6px" }} />
                )}
              </label>
            ))}
          </div>
          <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
            <button className="primary" onClick={() => void save()}>{t("save", locale)}</button>
            <button onClick={() => setEditing(null)}>{t("cancel", locale)}</button>
          </div>
        </div>
      )}
    </div>
  );
}

const CALIB_CFG: LedgerCfg = {
  listPath: "/calib/list", savePath: "/calib/save", deletePath: "/calib/delete",
  importPath: "/calib/import", templatePath: "/calib/template.xlsx",
  cntKeys: [["expired", "expired"], ["d30", "d30"], ["d60", "d60"], ["none", "none"]],
  levelFilter: [["ALERT", "alert"], ["WARN", "warn"], ["EXPIRED", "expired"], ["NONE", "none"]],
  columns: ["item_code", "item_name", "item_type", "model", "serial_no", "line_code", "last_calib_date", "cycle_months", "next_due", "days_left", "status"],
  formFields: [
    { k: "item_code" }, { k: "item_name" }, { k: "item_type", opts: ["量具", "飞达", "测试设备", "生产设备", "检具", "其他"] },
    { k: "model" }, { k: "brand" }, { k: "serial_no" }, { k: "line_code" }, { k: "dept" }, { k: "owner" },
    { k: "purchase_date", type: "date" }, { k: "last_calib_date", type: "date" }, { k: "cycle_months", type: "number" },
    { k: "next_due", type: "date" }, { k: "calib_vendor" }, { k: "cert_no" },
    { k: "result", opts: ["合格", "限用", "不合格"] }, { k: "status", opts: ["在用", "停用", "报废", "送检中"] }, { k: "remark" },
  ],
  kwPlaceholderKey: "w17.calib.kw", titleSuffix: "calib",
  extraFilters: [{ key: "type", optsKey: "types", labelSuffix: "item_type" }],
};

const FIXTURE_CFG: LedgerCfg = {
  listPath: "/fixture/list", savePath: "/fixture/save", deletePath: "/fixture/delete",
  importPath: "/fixture/import", templatePath: "/fixture/template.xlsx",
  cntKeys: [["expired", "overlife"], ["warn", "nearlife"], ["ok", "normal"], ["nolimit", "nolimit"]],
  levelFilter: [["WARN", "nearlife"], ["ALERT", "overlife"]],
  columns: ["fixture_code", "fixture_name", "fixture_type", "model", "line_code", "station_code", "life_limit", "used_count", "used_pct", "remain", "status"],
  formFields: [
    { k: "fixture_code" }, { k: "fixture_name" },
    { k: "fixture_type", opts: ["测试治具", "装配治具", "焊接治具", "过炉治具", "老化架", "载具", "检具", "其他"] },
    { k: "model" }, { k: "line_code" }, { k: "station_code" }, { k: "vendor" },
    { k: "purchase_date", type: "date" }, { k: "price", type: "number" }, { k: "life_limit", type: "number" },
    { k: "life_warn_pct", type: "number" }, { k: "status", opts: ["在用", "维修中", "停用", "报废"] }, { k: "owner" }, { k: "remark" },
  ],
  kwPlaceholderKey: "w17.fixture.kw", titleSuffix: "fixture",
  extraFilters: [
    { key: "type", optsKey: "types", labelSuffix: "fixture_type" },
    { key: "line", optsKey: "lines", labelSuffix: "line_code" },
    { key: "model", optsKey: "models", labelSuffix: "model" },
    { key: "status", optsKey: "status_opts", labelSuffix: "status" },
  ],
};

export function CalibView({ locale }: { locale: Locale }) { return <LedgerPage locale={locale} cfg={CALIB_CFG} />; }
export function FixtureView({ locale }: { locale: Locale }) { return <LedgerPage locale={locale} cfg={FIXTURE_CFG} />; }

// ── 超声工位看板（源 exec.ultra：KPI + 各小时产能 + 按工单 + 队列明细 + CSV）──
interface UltraBoard {
  date: string; date_end: string; is_range: boolean;
  items: Array<Record<string, unknown>>;
  stats: { wait: number; done: number; timeout: number; void: number; total: number; pass_rate: number; uph: number | null; cycle_sec: number | null; avg_wait_sec: number | null };
  hourly: number[]; by_mo: Array<{ mo_no: string; done: number }>;
}
export function UltraBoardView({ locale }: { locale: Locale }) {
  const [d, setD] = useState<UltraBoard | null>(null);
  const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [filter, setFilter] = useState("");
  const [err, setErr] = useState("");
  const load = useCallback(async () => {
    setErr("");
    try { setD(await mesrjApi.get<UltraBoard>("/ultra/board", { date: from, date_end: to })); }
    catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
  }, [from, to]);
  useEffect(() => { void load(); }, [load]);
  const items = (d?.items || []).filter(r => !filter || r.status === filter);
  const exportCsv = () => {
    const cols = ["queue_no", "sn", "mo_no", "product_model", "status", "scanned_at", "weld_at", "wait_min", "emp"];
    const head = cols.join(",");
    const body = items.map(r => cols.map(c => `"${String(r[c] ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\ufeff" + head + "\n" + body], { type: "text/csv" }));
    a.download = `ultra_${d?.date || ""}.csv`; a.click();
  };
  const s = d?.stats;
  return (
    <div>
      <div style={{ ...box, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={inp} />
        <span style={{ color: "#94a3b8" }}>~</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} style={inp} />
        <button onClick={() => { setFrom(""); setTo(""); }}>{t("w17.ultra.today", locale)}</button>
        <button onClick={exportCsv}>{t("w17.ultra.export", locale)}</button>
      </div>
      <Err msg={err} />
      {s && (
        <div style={box}>
          <Kpi items={[
            [t("w17.ultra.wait", locale), s.wait, "#2563EB"], [t("w17.ultra.done", locale), s.done, "#0F766E"],
            [t("w17.ultra.timeout", locale), s.timeout, "#B91C1C"], [t("w17.ultra.void", locale), s.void, "#94A3B8"],
            [t("w17.ultra.uph", locale), s.uph ?? "—"], [t("w17.ultra.cycle", locale), s.cycle_sec != null ? `${s.cycle_sec}s` : "—"],
            [t("w17.ultra.avgwait", locale), s.avg_wait_sec != null ? `${s.avg_wait_sec}s` : "—"],
            [t("w17.ultra.pass_rate", locale), `${s.pass_rate}%`],
          ]} />
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14 }}>
        <div style={box}>
          <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 13 }}>{t("w17.ultra.hourly", locale)}</div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 90 }}>
            {(d?.hourly || new Array(24).fill(0)).map((n, h) => (
              <div key={h} title={`${h}:00 = ${n}`} style={{ flex: 1, background: "#2563eb", height: `${Math.min(100, n * 6)}%`, minHeight: n ? 3 : 0, borderRadius: 2 }} />
            ))}
          </div>
        </div>
        <div style={box}>
          <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 13 }}>{t("w17.ultra.by_mo", locale)}</div>
          {(d?.by_mo || []).slice(0, 8).map(x => <div key={x.mo_no} style={{ fontSize: 12, display: "flex", justifyContent: "space-between" }}><span>{x.mo_no}</span><b>{x.done}</b></div>)}
        </div>
      </div>
      <div style={box}>
        <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
          {["", "等待焊", "已完成", "超时未焊", "已撤销"].map(f => (
            <button key={f || "all"} onClick={() => setFilter(f)} style={{ background: filter === f ? "#1e293b" : "#fff", color: filter === f ? "#fff" : "#334155", border: "1px solid #cbd5e1", borderRadius: 6, padding: "3px 10px", fontSize: 12 }}>{f || t("w17.all", locale)}</button>
          ))}
        </div>
        <Table header={[
          ["queue_no", "#"], ["sn", "SN"], ["mo_no", t("w17.f.calib.mo_no", locale)], ["product_model", t("w17.f.calib.model", locale)],
          ["status", t("w17.col.status", locale)], ["scanned_at", t("w17.ultra.scan_at", locale)], ["weld_at", t("w17.ultra.weld_at", locale)],
          ["wait_min", t("w17.ultra.wait", locale)], ["result", t("w17.f.calib.result", locale)], ["reason", t("w17.f.calib.remark", locale)],
        ]} rows={items} />
      </div>
    </div>
  );
}

// ── 超声参数维护（源 exec.ultraparam：cfg_ultra_limit 阈值表）──
interface UltraLimit { rows: Array<Record<string, unknown>>; default: Record<string, unknown>; note: string }
export function UltraParamView({ locale }: { locale: Locale }) {
  const [d, setD] = useState<UltraLimit | null>(null);
  const [form, setForm] = useState<Record<string, string>>({ model: "*", time_min: "", time_max: "", energy_min: "", energy_max: "", power_min: "", power_max: "" });
  const [err, setErr] = useState(""); const [msg, setMsg] = useState("");
  const load = useCallback(async () => {
    try { setD(await mesrjApi.get<UltraLimit>("/ultra/limit")); }
    catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const save = async () => {
    setErr(""); setMsg("");
    try {
      await mesrjApi.post("/ultra/limit", { ...form, enabled: 1 });
      setMsg(t("w17.saved", locale)); void load();
    } catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
  };
  return (
    <div>
      <div style={{ ...box, fontSize: 13, color: "#475569" }}>{d?.note || t("w17.ultraparam.hint", locale)}</div>
      <div style={box}>
        <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 13 }}>{t("w17.ultraparam.edit", locale)}</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <input value={form.model} onChange={e => setForm(f => ({ ...f, model: e.target.value }))} placeholder="* / 机型" style={{ ...inp, width: 120 }} />
          {["time_min", "time_max", "energy_min", "energy_max", "power_min", "power_max"].map(k => (
            <input key={k} value={form[k]} type="number" onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} placeholder={k} style={{ ...inp, width: 90 }} title={k} />
          ))}
          <button onClick={() => void save()}>{t("save", locale)}</button>
        </div>
      </div>
      <Err msg={err} /><Ok msg={msg} />
      <div style={box}>
        <Table header={[
          ["model", t("w17.f.calib.model", locale)], ["time_min", t("w17.ultraparam.tmin", locale)], ["time_max", t("w17.ultraparam.tmax", locale)],
          ["energy_min", t("w17.ultraparam.emin", locale)], ["energy_max", t("w17.ultraparam.emax", locale)],
          ["power_min", t("w17.ultraparam.pmin", locale)], ["power_max", t("w17.ultraparam.pmax", locale)], ["enabled", t("w17.col.status", locale)],
        ]} rows={(d?.rows || []).map(r => ({ ...r, enabled: Number(r.enabled) ? t("common.yes", locale) : t("common.no", locale) }))} />
      </div>
    </div>
  );
}

// ── 拆壳返工（源 exec.teardown：扫码 → 确认 → 记 action='拆壳'）──
interface Lookup { codes: Array<Record<string, unknown>>; rels: Array<Record<string, unknown>>; hist?: Array<Record<string, unknown>> }
export function TeardownView({ locale }: { locale: Locale }) {
  const [sn, setSn] = useState(""); const [d, setD] = useState<Lookup | null>(null);
  const [reason, setReason] = useState(""); const [err, setErr] = useState(""); const [msg, setMsg] = useState("");
  const [log, setLog] = useState<Record<string, unknown>[]>([]);
  const scanRef = useRef<HTMLInputElement>(null);
  const loadLog = useCallback(async () => {
    try { setLog((await mesrjApi.get<{ rows: Record<string, unknown>[] }>("/bind/decode/log", { limit: 30 })).rows || []); } catch { /* 非阻断 */ }
  }, []);
  useEffect(() => { void loadLog(); scanRef.current?.focus(); }, [loadLog]);
  const lookup = async () => {
    setErr(""); setMsg(""); setD(null);
    if (!sn.trim()) { setErr(t("w17.scan_first", locale)); return; }
    try { setD(await mesrjApi.get<Lookup>("/bind/lookup", { sn: sn.trim() })); }
    catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
  };
  const links = (d?.rels || []).filter(r => r.rel_type === "PCBA_Link" && Number(r.is_active ?? 1));
  const go = async () => {
    if (!links.length) return;
    if (!window.confirm(t("w17.teardown.confirm", locale))) return;
    setErr(""); setMsg("");
    try {
      const r = await mesrjApi.post<{ done?: unknown[] }>("/bind/teardown", { sn: sn.trim(), reason });
      setMsg(t("w17.teardown.done", locale)); setSn(""); setD(null); void loadLog();
      scanRef.current?.focus(); void r;
    } catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
  };
  return (
    <div>
      <div style={{ ...box, borderLeft: "4px solid #BA7517" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input ref={scanRef} value={sn} onChange={e => setSn(e.target.value)} onKeyDown={e => e.key === "Enter" && void lookup()}
            placeholder={t("w17.teardown.ph", locale)} style={{ flex: 1, minWidth: 280, height: 38, fontSize: 15, fontFamily: "Consolas,monospace", padding: "0 10px" }} />
          <button onClick={() => void lookup()}>{t("search", locale)}</button>
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: "#B45309" }}>{t("w17.teardown.warn", locale)}</div>
      </div>
      <Err msg={err} /><Ok msg={msg} />
      {d && links.length > 0 && (
        <div style={box}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>{t("w17.teardown.confirm_title", locale)}</div>
          {links.map((r, i) => (
            <div key={i} style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
              <span style={{ border: "1px solid #185FA5", background: "#E6F1FB", borderRadius: 8, padding: "6px 12px", fontFamily: "monospace" }}>{String(r.parent_sn)} <small>PCBA</small></span>
              <span style={{ color: "#A32D2D" }}>→</span>
              <span style={{ border: "1px solid #F09595", background: "#FCEBEB", borderRadius: 8, padding: "6px 12px", fontFamily: "monospace" }}>{String(r.child_sn)} <small>{t("w17.teardown.label_void", locale)}</small></span>
            </div>
          ))}
          <div style={{ margin: "10px 0", fontSize: 12, color: "#475569", borderLeft: "4px solid #A32D2D", background: "#FEF2F2", padding: "8px 12px", borderRadius: 6, lineHeight: 1.7 }}>{t("w17.teardown.effect", locale)}</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input value={reason} onChange={e => setReason(e.target.value)} placeholder={t("w17.teardown.reason_ph", locale)} style={{ ...inp, width: 280 }} />
            <button onClick={() => void go()} style={{ background: "#A32D2D", color: "#fff", border: "none", borderRadius: 6, padding: "7px 14px" }}>{t("w17.teardown.go", locale)}</button>
          </div>
        </div>
      )}
      {d && links.length === 0 && <div style={box}><span style={{ color: "#64748B", fontSize: 13 }}>{t("w17.teardown.nolink", locale)}</span></div>}
      <div style={box}>
        <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 13 }}>{t("w17.teardown.log", locale)}</div>
        <Table header={[
          ["created_at", t("itf.time", locale)], ["action", t("w17.teardown.action", locale)],
          ["parent_sn", "PCBA"], ["child_sn", t("w17.teardown.label", locale)], ["reason", t("w17.f.calib.remark", locale)], ["operator", t("w17.col.operator", locale)],
        ]} rows={log} />
      </div>
    </div>
  );
}

// ── 老化时效（源 exec.agingctl：老化中/合格/不足 + 进/出老化 + 要求时长规则）──
interface AgingList { rows: Record<string, unknown>[]; cnt: Record<string, number>; result_opts: string[] }
export function AgingCtlView({ locale }: { locale: Locale }) {
  const [d, setD] = useState<AgingList | null>(null);
  const [st, setSt] = useState(""); const [kw, setKw] = useState("");
  const [sn, setSn] = useState(""); const [err, setErr] = useState(""); const [msg, setMsg] = useState("");
  const [rules, setRules] = useState<Record<string, unknown>[]>([]);
  const [rule, setRule] = useState<Record<string, string>>({ model: "", req_hours: "", remark: "" });
  const load = useCallback(async () => {
    setErr("");
    try {
      setD(await mesrjApi.get<AgingList>("/aging/list", { status: st, keyword: kw }));
      setRules((await mesrjApi.get<{ rows: Record<string, unknown>[] }>("/aging/rule/list")).rows || []);
    } catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
  }, [st, kw]);
  useEffect(() => { void load(); }, [load]);
  const act = async (path: "/aging/in" | "/aging/out") => {
    setErr(""); setMsg("");
    if (!sn.trim()) { setErr(t("w17.scan_first", locale)); return; }
    try { await mesrjApi.post(path, { sn: sn.trim() }); setMsg(t(path === "/aging/in" ? "w17.aging.in_ok" : "w17.aging.out_ok", locale)); setSn(""); void load(); }
    catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
  };
  const saveRule = async () => {
    setErr(""); setMsg("");
    try { await mesrjApi.post("/aging/rule/save", { ...rule, enabled: 1 }); setMsg(t("w17.saved", locale)); void load(); }
    catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
  };
  const c = d?.cnt || {};
  return (
    <div>
      <div style={box}>
        <Kpi items={[[t("w17.aging.running", locale), c.running ?? 0, "#2563EB"], [t("w17.aging.ready", locale), c.ready ?? 0, "#B45309"], [t("w17.aging.fail", locale), c.fail ?? 0, "#B91C1C"], [t("w17.aging.ok", locale), c.ok ?? 0, "#0F766E"]]} />
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
          <select value={st} onChange={e => setSt(e.target.value)} style={inp}>
            <option value="">{t("w17.all", locale)}</option>
            <option value="running">{t("w17.aging.running", locale)}</option>
            <option value="finished">{t("w17.aging.finished", locale)}</option>
            <option value="fail">{t("w17.aging.fail", locale)}</option>
          </select>
          <input value={kw} onChange={e => setKw(e.target.value)} placeholder="SN / MO" style={{ ...inp, width: 200 }} />
          <button onClick={() => void load()}>{t("search", locale)}</button>
          <span style={{ flex: 1 }} />
          <input value={sn} onChange={e => setSn(e.target.value)} placeholder={t("w17.aging.scan_ph", locale)} style={{ ...inp, width: 200, fontFamily: "monospace" }} />
          <button onClick={() => void act("/aging/in")}>{t("w17.aging.in", locale)}</button>
          <button onClick={() => void act("/aging/out")}>{t("w17.aging.out", locale)}</button>
        </div>
      </div>
      <Err msg={err} /><Ok msg={msg} />
      <div style={box}>
        <Table header={[
          ["sn", "SN"], ["mo_no", t("w17.col.mo", locale)], ["model", t("w17.f.calib.model", locale)],
          ["in_time", t("w17.aging.in_time", locale)], ["out_time", t("w17.aging.out_time", locale)],
          ["actual_hours", t("w17.aging.actual_h", locale)], ["req_hours", t("w17.aging.req_h", locale)],
          ["hours_left", t("w17.aging.left_h", locale)], ["result", t("w17.f.calib.result", locale)], ["level", t("w17.col.level", locale)],
        ]} rows={(d?.rows || []).map(r => ({ ...r, level: r.level ? lvTag(locale, String(r.level)) : "" }))} />
      </div>
      <div style={box}>
        <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 13 }}>{t("w17.aging.rules", locale)}</div>
        <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
          <input value={rule.model} onChange={e => setRule(r => ({ ...r, model: e.target.value }))} placeholder={t("w17.aging.rule_model", locale)} style={{ ...inp, width: 160 }} />
          <input value={rule.req_hours} onChange={e => setRule(r => ({ ...r, req_hours: e.target.value }))} type="number" placeholder={t("w17.aging.req_h", locale)} style={{ ...inp, width: 100 }} />
          <input value={rule.remark} onChange={e => setRule(r => ({ ...r, remark: e.target.value }))} placeholder={t("w17.f.calib.remark", locale)} style={{ ...inp, width: 160 }} />
          <button onClick={() => void saveRule()}>{t("save", locale)}</button>
        </div>
        <Table header={[["model", t("w17.f.calib.model", locale)], ["req_hours", t("w17.aging.req_h", locale)], ["enabled", t("w17.col.status", locale)], ["remark", t("w17.f.calib.remark", locale)]]}
          rows={rules.map(r => ({ ...r, enabled: Number(r.enabled) ? t("common.enabled.y", locale) : t("common.enabled.n", locale) }))} />
      </div>
    </div>
  );
}

// ── 镭雕回读核对（源 exec.lasercheck：批次列表 + 批次核对）──
interface BatchCompare { batch: Record<string, unknown>; rows: Record<string, unknown>[]; extra: Record<string, unknown>[]; cnt: Record<string, number> }
export function LaserCheckView({ locale }: { locale: Locale }) {
  const [batches, setBatches] = useState<Record<string, unknown>[]>([]);
  const [cmp, setCmp] = useState<BatchCompare | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    (async () => {
      try { setBatches((await mesrjApi.get<{ rows: Record<string, unknown>[] }>("/laser/batch/list")).rows || []); }
      catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
    })();
  }, []);
  const open = async (id: unknown) => {
    setErr("");
    try { setCmp(await mesrjApi.get<BatchCompare>("/laser/batch/compare", { batch_id: id })); }
    catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
  };
  const close = async (id: unknown) => {
    if (!window.confirm(t("w17.laser.close_confirm", locale))) return;
    try { await mesrjApi.post("/laser/batch/close", { id }); }
    catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
  };
  const cnt = cmp?.cnt;
  return (
    <div>
      <Err msg={err} />
      <div style={box}>
        <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 13 }}>{t("w17.laser.batches", locale)}</div>
        <Table header={[
          ["batch_no", t("w17.laser.batch", locale)], ["mo_no", t("w17.col.mo", locale)], ["product_model", t("w17.f.calib.model", locale)],
          ["qty", t("w17.laser.qty", locale)], ["start_seq", t("w17.laser.seq_from", locale)], ["end_seq", t("w17.laser.seq_to", locale)],
          ["day", t("w17.col.date", locale)], ["status", t("w17.col.status", locale)], ["__act", t("w17.col.actions", locale)],
        ]} rows={batches.map(b => ({ ...b, __act: (
          <span>
            <button style={{ fontSize: 11, marginRight: 4 }} onClick={() => void open(b.id)}>{t("w17.laser.check", locale)}</button>
            {b.status !== "已关闭" && <button style={{ fontSize: 11 }} onClick={() => void close(b.id)}>{t("w17.laser.close", locale)}</button>}
          </span>
        ) }))} />
      </div>
      {cmp && (
        <div style={box}>
          <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 13 }}>{t("w17.laser.batch", locale)} {String(cmp.batch?.batch_no)}　
            <span style={{ color: "#0F766E" }}>{t("w17.laser.ok", locale)} {cnt?.ok ?? 0}</span>　
            <span style={{ color: "#B91C1C" }}>{t("w17.laser.miss", locale)} {cnt?.miss ?? 0}</span>　
            <span style={{ color: "#B45309" }}>{t("w17.laser.pending", locale)} {cnt?.pending ?? 0}</span>　
            <span style={{ color: "#64748B" }}>{t("w17.laser.extra", locale)} {cnt?.extra ?? 0}</span>　
            <span>{t("w17.laser.rate", locale)} {cnt?.rate ?? 0}%</span>
          </div>
          <Table header={[["seq", "#"], ["sn", "SN"], ["state", t("w17.col.level", locale)], ["read_at", t("w17.laser.read_at", locale)], ["src", t("w17.laser.src", locale)]]}
            rows={[...cmp.rows.map(r => ({ ...r, state: lvTag(locale, String(r.state === "ok" ? "OK" : r.state === "miss" ? "EXPIRED" : r.state === "pending" ? "WARN" : "NONE")) })),
            ...(cmp.extra || []).map(x => ({ seq: "—", sn: x.sn, state: lvTag(locale, "NONE"), read_at: x.read_at, src: x.src }))]} />
        </div>
      )}
    </div>
  );
}

// ── 成品库龄（源 prod.shelflife：已封箱批次库龄 + 机型保质期规则）──
interface ShelfBoard { rows: Record<string, unknown>[]; cnt: Record<string, number>; models: string[] }
export function ShelfLifeView({ locale }: { locale: Locale }) {
  const [d, setD] = useState<ShelfBoard | null>(null);
  const [level, setLevel] = useState(""); const [kw, setKw] = useState(""); const [model, setModel] = useState("");
  const [err, setErr] = useState(""); const [msg, setMsg] = useState("");
  const [rules, setRules] = useState<Record<string, unknown>[]>([]);
  const [rule, setRule] = useState<Record<string, string>>({ model: "", shelf_days: "", warn_days: "", remark: "" });
  const load = useCallback(async () => {
    setErr("");
    try {
      setD(await mesrjApi.get<ShelfBoard>("/shelflife/board", { level, keyword: kw, model }));
      setRules((await mesrjApi.get<{ rows: Record<string, unknown>[] }>("/shelflife/rule/list")).rows || []);
    } catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
  }, [level, kw, model]);
  useEffect(() => { void load(); }, [load]);
  const saveRule = async () => {
    setErr(""); setMsg("");
    try { await mesrjApi.post("/shelflife/rule/save", { ...rule, enabled: 1 }); setMsg(t("w17.saved", locale)); void load(); }
    catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
  };
  const c = d?.cnt || {};
  return (
    <div>
      <div style={box}>
        <Kpi items={[[t("w17.shelf.expired", locale), c.expired ?? 0, "#B91C1C"], [t("w17.shelf.warn", locale), c.warn ?? 0, "#B45309"], [t("w17.shelf.ok", locale), c.ok ?? 0, "#0F766E"], [t("w17.shelf.norule", locale), c.norule ?? 0, "#94A3B8"]]} />
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <select value={level} onChange={e => setLevel(e.target.value)} style={inp}>
            <option value="">{t("w17.all", locale)}</option>
            <option value="EXPIRED">{t("w17.shelf.expired", locale)}</option>
            <option value="WARN">{t("w17.shelf.warn", locale)}</option>
            <option value="OK">{t("w17.shelf.ok", locale)}</option>
            <option value="NORULE">{t("w17.shelf.norule", locale)}</option>
          </select>
          <select value={model} onChange={e => setModel(e.target.value)} style={inp}>
            <option value="">{t("w17.f.calib.model", locale)}</option>
            {(d?.models || []).map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <input value={kw} onChange={e => setKw(e.target.value)} placeholder={t("w17.shelf.kw", locale)} style={{ ...inp, width: 200 }} />
          <button onClick={() => void load()}>{t("search", locale)}</button>
        </div>
      </div>
      <Err msg={err} /><Ok msg={msg} />
      <div style={box}>
        <Table header={[
          ["box_no", t("w17.shelf.box", locale)], ["pallet_no", t("w17.shelf.pallet", locale)], ["mo_no", t("w17.col.mo", locale)],
          ["product_model", t("w17.f.calib.model", locale)], ["qty", t("w17.laser.qty", locale)],
          ["stock_in_time", t("w17.shelf.stock_in", locale)], ["days", t("w17.shelf.days", locale)],
          ["shelf_days", t("w17.shelf.shelf", locale)], ["days_left", t("w17.aging.left_h", locale)], ["level", t("w17.col.level", locale)],
        ]} rows={(d?.rows || []).map(r => ({ ...r, level: r.level ? lvTag(locale, String(r.level)) : "" }))} />
      </div>
      <div style={box}>
        <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 13 }}>{t("w17.shelf.rules", locale)}</div>
        <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
          <input value={rule.model} onChange={e => setRule(r => ({ ...r, model: e.target.value }))} placeholder={t("w17.f.calib.model", locale)} style={{ ...inp, width: 150 }} />
          <input value={rule.shelf_days} onChange={e => setRule(r => ({ ...r, shelf_days: e.target.value }))} type="number" placeholder={t("w17.shelf.shelf", locale)} style={{ ...inp, width: 100 }} />
          <input value={rule.warn_days} onChange={e => setRule(r => ({ ...r, warn_days: e.target.value }))} type="number" placeholder={t("w17.shelf.warn_days", locale)} style={{ ...inp, width: 100 }} />
          <input value={rule.remark} onChange={e => setRule(r => ({ ...r, remark: e.target.value }))} placeholder={t("w17.f.calib.remark", locale)} style={{ ...inp, width: 150 }} />
          <button onClick={() => void saveRule()}>{t("save", locale)}</button>
        </div>
        <Table header={[["model", t("w17.f.calib.model", locale)], ["shelf_days", t("w17.shelf.shelf", locale)], ["warn_days", t("w17.shelf.warn_days", locale)], ["enabled", t("w17.col.status", locale)], ["remark", t("w17.f.calib.remark", locale)]]}
          rows={rules.map(r => ({ ...r, enabled: Number(r.enabled) ? t("common.enabled.y", locale) : t("common.enabled.n", locale) }))} />
      </div>
    </div>
  );
}

// ── 工位质量看板（源 report.stboard：多工位 × 日期 → 投入/产出/FPY/NDF）──
interface StBoard { from: string; to: string; stations: string[]; summary: Record<string, unknown>[]; rows: Record<string, unknown>[]; errors: string[] }
const ST_PRESETS = [
  { code: "DIP-L02-ICT", label: "ICT" }, { code: "DIP-L02-FCT", label: "FCT" },
  { code: "ASSY-L02-ATE", label: "ATE1" }, { code: "ASSY-L02-AGING", label: "AGING" }, { code: "PACK-L02-HIPOT", label: "HIPOT" },
];
export function StationBoardView({ locale }: { locale: Locale }) {
  const [on, setOn] = useState<Record<string, boolean>>({ "DIP-L02-ICT": true, "DIP-L02-FCT": true, "ASSY-L02-ATE": true, "ASSY-L02-AGING": false, "PACK-L02-HIPOT": false });
  const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [d, setD] = useState<StBoard | null>(null);
  const [err, setErr] = useState("");
  const load = useCallback(async () => {
    setErr("");
    const stations = ST_PRESETS.filter(s => on[s.code]).map(s => s.code).join(",");
    if (!stations) { setD(null); return; }
    try { setD(await mesrjApi.get<StBoard>("/report/station-board", { from, to, stations })); }
    catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
  }, [on, from, to]);
  useEffect(() => { void load(); }, [load]);
  const grade = (v: unknown) => {
    const n = Number(v);
    if (!isFinite(n) || v === null || v === undefined || v === "") return <span style={{ color: "#94A3B8" }}>—</span>;
    const c = n >= 99 ? "#0F766E" : n >= 95 ? "#B45309" : "#B91C1C";
    return <b style={{ color: c }}>{n.toFixed(1)}%</b>;
  };
  return (
    <div>
      <div style={{ ...box, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {ST_PRESETS.map(s => (
          <button key={s.code} onClick={() => setOn(o => ({ ...o, [s.code]: !o[s.code] }))}
            style={{ border: "1px solid #cbd5e1", borderRadius: 6, padding: "3px 10px", fontSize: 12, background: on[s.code] ? "#1e293b" : "#fff", color: on[s.code] ? "#fff" : "#334155" }}>{s.label}</button>
        ))}
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={inp} />
        <span style={{ color: "#94a3b8" }}>~</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} style={inp} />
        <button onClick={() => void load()}>{t("search", locale)}</button>
      </div>
      <Err msg={err} />
      {d?.errors?.length ? <div style={{ ...box, color: "#B45309", fontSize: 12 }}>{d.errors.join("；")}</div> : null}
      <div style={box}>
        <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 13 }}>{t("w17.stboard.summary", locale)}</div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead><tr>
            {[t("w17.col.station", locale), t("w17.stboard.in", locale), t("w17.stboard.out", locale), t("w17.stboard.ng", locale), t("w17.stboard.ndf", locale), t("w17.stboard.yield", locale), "FPY", "NDF%"].map(h => <th key={h} style={{ padding: "6px 8px", borderBottom: "1px solid #e2e8f0", textAlign: "left" }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {(d?.summary || []).map((r, i) => (
              <tr key={i} style={{ borderBottom: "1px solid #f1f5f9" }}>
                <td style={{ padding: "5px 8px" }}>{String(r.station_name || r.station_code)}</td>
                <td style={{ padding: "5px 8px" }}>{String(r.in_qty)}</td>
                <td style={{ padding: "5px 8px" }}>{String(r.out_qty)}</td>
                <td style={{ padding: "5px 8px" }}>{String(r.ng_qty)}</td>
                <td style={{ padding: "5px 8px" }}>{String(r.ndf_qty)}</td>
                <td style={{ padding: "5px 8px" }}>{grade(r.yield)}</td>
                <td style={{ padding: "5px 8px" }}>{grade(r.fpy)}</td>
                <td style={{ padding: "5px 8px" }}>{grade(r.ndf)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={box}>
        <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 13 }}>{t("w17.stboard.daily", locale)}</div>
        <Table header={[
          ["station_name", t("w17.col.station", locale)], ["day", t("w17.col.date", locale)],
          ["in_qty", t("w17.stboard.in", locale)], ["out_qty", t("w17.stboard.out", locale)],
          ["ng_qty", t("w17.stboard.ng", locale)], ["ndf_qty", t("w17.stboard.ndf", locale)],
          ["yield", t("w17.stboard.yield", locale)], ["fpy", "FPY"], ["ndf", "NDF%"],
        ]} rows={d?.rows || []} />
      </div>
    </div>
  );
}

// ── 组织架构（源 sys.dept：部门树 + 编辑）──
interface DeptTree { rows: Record<string, unknown>[]; total: number }
export function DeptView({ locale }: { locale: Locale }) {
  const [d, setD] = useState<DeptTree | null>(null);
  const [editing, setEditing] = useState<Record<string, string> | null>(null);
  const [err, setErr] = useState(""); const [msg, setMsg] = useState("");
  const load = useCallback(async () => {
    setErr("");
    try { setD(await mesrjApi.get<DeptTree>("/dept/tree")); }
    catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const save = async () => {
    if (!editing) return;
    setErr(""); setMsg("");
    try { await mesrjApi.post("/dept/save", editing); setMsg(t("w17.saved", locale)); setEditing(null); void load(); }
    catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
  };
  const del = async (id: unknown) => {
    if (!window.confirm(t("w17.confirm_delete", locale))) return;
    setErr("");
    try { await mesrjApi.post("/dept/delete", { id }); void load(); }
    catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
  };
  return (
    <div>
      <div style={{ ...box, display: "flex", gap: 8, alignItems: "center" }}>
        <b style={{ fontSize: 14 }}>{t("menu.sys.dept", locale)}</b>
        <span style={{ flex: 1 }} />
        <button onClick={() => setEditing({ dept_code: "", dept_name: "", parent_code: "", leader: "", phone: "", dept_type: "general", status: "1", remark: "" })}>＋ {t("w17.add", locale)}</button>
      </div>
      <Err msg={err} /><Ok msg={msg} />
      <div style={box}>
        <Table header={[
          ["dept_name", t("w17.dept.name", locale)], ["dept_code", t("w17.dept.code", locale)],
          ["leader", t("w17.dept.leader", locale)], ["phone", t("w17.dept.phone", locale)],
          ["user_cnt", t("w17.dept.users", locale)], ["status", t("w17.col.status", locale)],
          ["remark", t("w17.f.calib.remark", locale)], ["__act", t("w17.col.actions", locale)],
        ]} rows={(d?.rows || []).map(r => ({
          ...r,
          dept_name: `${"　".repeat(Number(r.depth || 0))}${String(r.dept_name || "")}`,
          status: Number(r.status) ? t("common.enabled.y", locale) : t("common.enabled.n", locale),
          __act: (
            <span>
              <button style={{ fontSize: 11, marginRight: 4 }} onClick={() => setEditing({ id: String(r.id), dept_code: String(r.dept_code || ""), dept_name: String(r.dept_name || ""), parent_code: String(r.parent_code || ""), leader: String(r.leader || ""), phone: String(r.phone || ""), dept_type: String(r.dept_type || "general"), status: String(r.status ?? 1), remark: String(r.remark || "") })}>✎</button>
              <button style={{ fontSize: 11 }} onClick={() => void del(r.id)}>✕</button>
            </span>
          ),
        }))} />
      </div>
      {editing && (
        <div style={{ ...box, background: "#f8fafc" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 8 }}>
            {(["dept_code", "dept_name", "parent_code", "leader", "phone", "remark"] as const).map(k => (
              <label key={k} style={{ fontSize: 12 }}>{t(`w17.dept.${k}`, locale)}
                <input value={editing[k] ?? ""} onChange={e => setEditing(x => ({ ...(x || {}), [k]: e.target.value }))} style={{ display: "block", width: "100%", marginTop: 2, padding: "4px 6px" }} />
              </label>
            ))}
            <label style={{ fontSize: 12 }}>{t("w17.col.status", locale)}
              <select value={editing.status ?? "1"} onChange={e => setEditing(x => ({ ...(x || {}), status: e.target.value }))} style={{ display: "block", width: "100%", marginTop: 2 }}>
                <option value="1">{t("common.enabled.y", locale)}</option><option value="0">{t("common.enabled.n", locale)}</option>
              </select>
            </label>
          </div>
          <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
            <button onClick={() => void save()}>{t("save", locale)}</button>
            <button onClick={() => setEditing(null)}>{t("cancel", locale)}</button>
          </div>
        </div>
      )}
    </div>
  );
}
