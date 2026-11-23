// ============================================================================
// MES-ruijing W20 前端 —— 收尾两屏（源 web/pages.js cfg.basic / sys.info）
//   cfg.basic  基础数据维护：工段字典 / 班次与工时 / 产能标准（UPH）/ 关键参数
//              四页签，就地编辑 + 批量保存；后端全部复用既有路由
//              （/cfg/basic/process|shift|params、/plan/capmaster/list|save|delete）
//   sys.info   系统信息：运行信息 + 数据量 + 现有 MES 对接配置（含测试连接）
//              + 设备接入状态 + 测试参数明细
//              （/sysinfo、/itf/config|save|test、/exec/device/health、/cfg/machinetest）
// 源屏里的「后端代码已更新未重启」红条、内网访问地址、本地部署说明依赖 SQLite
// 单机部署才有的 needs_restart / ips 字段，PG 版 /sysinfo 不返回，不移植。
// 约定见 views-w19.tsx：无新依赖、无 CSS 文件、就地表格、条码优先。
// ============================================================================
import { useCallback, useEffect, useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { mesrjApi, mesrjMsg } from "./api";
import { t } from "./i18n";

const box = { border: "1px solid var(--border, #e2e8f0)", borderRadius: 10, padding: 14, marginBottom: 14 } as const;
const inp = { padding: "6px 8px", marginRight: 6 } as const;
const th = { padding: "6px 8px", borderBottom: "1px solid var(--border, #e2e8f0)", textAlign: "left" as const, whiteSpace: "nowrap" as const };
const td = { padding: "5px 8px", borderBottom: "1px solid #f1f5f9", fontSize: 12 };
const muted = { color: "#64748b", fontSize: 12 } as const;
const mono = { fontFamily: "monospace" } as const;
const editor = { ...box, background: "var(--accent-soft, #f8fafc)" } as const;

function Err({ msg }: { msg: string }) {
  if (!msg) return null;
  return <div style={{ color: "#b91c1c", padding: "6px 0", fontSize: 13, whiteSpace: "pre-wrap" }}>{msg}</div>;
}
function Ok({ msg }: { msg: string }) {
  if (!msg) return null;
  return <div style={{ color: "#15803d", padding: "6px 0", fontSize: 13 }}>{msg}</div>;
}
const errText = (ex: unknown) => (ex instanceof Error ? ex.message : String(ex));
const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const dt = (v: unknown) => s(v).slice(0, 19).replace("T", " ").replace("Z", "");

// 表单字段：文本/数字一格 + 复选框一格（三个编辑面板共用，字段名由调用点写死）
function Field({ label, value, onChange, type, ph, width }: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; ph?: string; width?: number;
}) {
  return (
    <label style={{ fontSize: 12, display: "inline-block", marginRight: 12, marginBottom: 8 }}>
      {label}
      <input type={type || "text"} value={value} placeholder={ph || ""} onChange={e => onChange(e.target.value)}
        style={{ display: "block", marginTop: 2, padding: "4px 6px", width: width ?? 150 }} />
    </label>
  );
}
function Check({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ fontSize: 12, display: "inline-block", marginRight: 12, marginBottom: 8 }}>
      {label}
      <input type="checkbox" checked={value} style={{ marginLeft: 6 }} onChange={e => onChange(e.target.checked)} />
    </label>
  );
}
function Pick({ label, value, opts, onChange, width }: {
  label: string; value: string; opts: string[]; onChange: (v: string) => void; width?: number;
}) {
  return (
    <label style={{ fontSize: 12, display: "inline-block", marginRight: 12, marginBottom: 8 }}>
      {label}
      <select value={value} onChange={e => onChange(e.target.value)}
        style={{ display: "block", marginTop: 2, padding: "4px 6px", width: width ?? 150 }}>
        {opts.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

// ============================================================================
// cfg.basic 基础数据维护
// ============================================================================
type BasicTab = "process" | "shift" | "cap" | "param";

// ── 1. 工段字典（源 /cfg/basic/process + /save + /delete）──
interface ProcRow {
  id: number | string; process_code: string; process_name?: string; sort_no?: number | string;
  station_keywords?: string; enabled?: number | string; remark?: string;
  cap_cnt?: number | string; plan_cnt?: number | string; rep_cnt?: number | string;
}

function ProcessTab({ locale }: { locale: Locale }) {
  const [rows, setRows] = useState<ProcRow[]>([]);
  const [code, setCode] = useState(""); const [name, setName] = useState("");
  const [sort, setSort] = useState("10"); const [kws, setKws] = useState("");
  const [on, setOn] = useState(true); const [rmk, setRmk] = useState("");
  const [editId, setEditId] = useState<number | string | null>(null);
  const [origCode, setOrigCode] = useState("");
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState(""); const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setErr("");
    try {
      const d = await mesrjApi.get<{ rows?: ProcRow[] }>("/cfg/basic/process");
      setRows(d?.rows || []);
    } catch (ex) { setErr(errText(ex)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const close = () => { setOpen(false); setEditId(null); };
  const addNew = () => {
    setCode(""); setName(""); setSort(String((rows.length + 1) * 10)); setKws("");
    setOn(true); setRmk(""); setEditId(null); setOrigCode(""); setErr(""); setOpen(true);
  };
  const edit = (r: ProcRow) => {
    setCode(r.process_code); setName(s(r.process_name)); setSort(s(r.sort_no) || "0");
    setKws(s(r.station_keywords)); setOn(Number(r.enabled) ? true : false); setRmk(s(r.remark));
    setEditId(r.id); setOrigCode(r.process_code); setErr(""); setOpen(true);
  };
  const save = async () => {
    if (!code.trim()) { setErr(t("w20.basic.proc.codeReq", locale)); return; }
    if (editId !== null && origCode && code.trim() !== origCode
      && !window.confirm(t("w20.basic.proc.codeChange", locale))) return;
    setErr(""); setMsg(""); setBusy(true);
    try {
      const d = await mesrjMsg.post("/cfg/basic/process/save", {
        id: editId, process_code: code, process_name: name, sort_no: sort,
        station_keywords: kws, enabled: on ? 1 : 0, remark: rmk,
      });
      setMsg(d.msg || t("w17.saved", locale)); close(); void load();
    } catch (ex) { setErr(errText(ex)); }
    finally { setBusy(false); }
  };
  const del = async (r: ProcRow) => {
    if (!window.confirm(t("w20.basic.proc.delConfirm", locale))) return;
    setErr(""); setMsg("");
    try {
      const d = await mesrjMsg.post("/cfg/basic/process/delete", { id: r.id });
      setMsg(d.msg || t("w17.saved", locale)); void load();
    } catch (ex) { setErr(errText(ex)); }
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
        <button onClick={addNew}>{t("w20.basic.proc.add", locale)}</button>
        <span style={{ flex: 1 }} />
        <span style={muted}>{t("w20.basic.proc.codeIsTruth", locale)}</span>
        <button onClick={() => void load()}>{t("refresh", locale)}</button>
      </div>
      <Err msg={err} /><Ok msg={msg} />
      {open && (
        <div style={editor}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>
            {editId === null ? t("w20.basic.proc.add", locale) : `${t("common.edit", locale)} · ${origCode}`}
          </div>
          <Field label={t("w20.basic.proc.code", locale)} value={code} onChange={setCode} ph="SMT-PCB1" />
          <Field label={t("w20.basic.proc.name", locale)} value={name} onChange={setName} width={190} />
          <Field label={t("emp.skill.sort_no", locale)} value={sort} onChange={setSort} type="number" width={70} />
          <Check label={t("common.enabled.y", locale)} value={on} onChange={setOn} />
          <div>
            <Field label={t("w20.basic.proc.keywords", locale)} value={kws} onChange={setKws} ph="AI,ICT" width={420} />
            <Field label={t("remark", locale)} value={rmk} onChange={setRmk} width={420} />
          </div>
          <div style={{ ...muted, marginBottom: 8 }}>{t("w20.basic.proc.kwHint", locale)}</div>
          <button disabled={busy} onClick={() => void save()}>{t("save", locale)}</button>
          <button style={{ marginLeft: 6 }} onClick={close}>{t("cancel", locale)}</button>
        </div>
      )}
      {!rows.length ? <div style={muted}>{t("no_data", locale)}</div> : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead><tr>
            <th style={th}>{t("w20.basic.proc.code", locale)}</th>
            <th style={th}>{t("w20.basic.proc.name", locale)}</th>
            <th style={{ ...th, textAlign: "right" }}>{t("emp.skill.sort_no", locale)}</th>
            <th style={th}>{t("w20.basic.proc.keywords", locale)}</th>
            <th style={{ ...th, textAlign: "center" }}>{t("w20.basic.proc.ref", locale)}</th>
            <th style={{ ...th, textAlign: "center" }}>{t("status", locale)}</th>
            <th style={th}>{t("op", locale)}</th>
          </tr></thead>
          <tbody>
            {rows.map(r => {
              const ks = s(r.station_keywords).split(",").map(x => x.trim()).filter(Boolean);
              return (
                <tr key={String(r.id)}>
                  <td style={{ ...td, ...mono, fontWeight: 600 }}>{r.process_code}</td>
                  <td style={td}>{r.process_name || r.process_code}</td>
                  <td style={{ ...td, textAlign: "right" }}>{s(r.sort_no)}</td>
                  <td style={td}>
                    {ks.length
                      ? ks.map(k => (
                        <span key={k} style={{ ...muted, ...mono, border: "1px solid var(--border, #e2e8f0)", borderRadius: 4, padding: "1px 5px", marginRight: 4 }}>{k}</span>
                      ))
                      : <span style={{ color: "#b45309", fontSize: 11 }}>{t("w20.basic.proc.kwNone", locale)}</span>}
                  </td>
                  <td style={{ ...td, textAlign: "center" }}>{s(r.cap_cnt) || 0} / {s(r.plan_cnt) || 0} / {s(r.rep_cnt) || 0}</td>
                  <td style={{ ...td, textAlign: "center" }}>{Number(r.enabled) ? t("common.enabled.y", locale) : t("common.enabled.n", locale)}</td>
                  <td style={td}>
                    <button onClick={() => edit(r)}>{t("common.edit", locale)}</button>
                    <button style={{ marginLeft: 6 }} onClick={() => void del(r)}>{t("common.delete", locale)}</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── 2. 班次与有效工时（源 /cfg/basic/shift + /save，整表批量保存）──
interface ShiftRow {
  shift_code: string; shift_name?: string; begin_time?: string; end_time?: string;
  cross_day?: number | string; work_hours?: number | string;
}

function ShiftTab({ locale }: { locale: Locale }) {
  const [rows, setRows] = useState<ShiftRow[]>([]);
  const [note, setNote] = useState("");
  const [err, setErr] = useState(""); const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setErr("");
    try {
      const d = await mesrjApi.get<{ rows?: ShiftRow[]; note?: string }>("/cfg/basic/shift");
      setRows(d?.rows || []); setNote(d?.note || "");
    } catch (ex) { setErr(errText(ex)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const patch = (i: number, p: Partial<ShiftRow>) =>
    setRows(rs => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const save = async () => {
    setErr(""); setMsg(""); setBusy(true);
    try {
      const d = await mesrjMsg.post("/cfg/basic/shift/save", {
        rows: rows.filter(r => r.shift_code.trim())
          .map(r => ({
            shift_code: r.shift_code, shift_name: s(r.shift_name), begin_time: s(r.begin_time),
            end_time: s(r.end_time), cross_day: Number(r.cross_day) ? 1 : 0, work_hours: s(r.work_hours),
          })),
      });
      setMsg(d.msg || t("w17.saved", locale)); void load();
    } catch (ex) { setErr(errText(ex)); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <Err msg={err} /><Ok msg={msg} />
      {note && <div style={{ ...muted, marginBottom: 10 }}>{note}</div>}
      {!rows.length && <div style={{ ...muted, marginBottom: 10 }}>{t("no_data", locale)}</div>}
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead><tr>
          <th style={th}>{t("w20.basic.shift.code", locale)}</th>
          <th style={th}>{t("cfg.dict.name", locale)}</th>
          <th style={th}>{t("md.shift.begin_time", locale)}</th>
          <th style={th}>{t("md.shift.end_time", locale)}</th>
          <th style={{ ...th, textAlign: "center" }}>{t("md.shift.cross_day", locale)}</th>
          <th style={{ ...th, textAlign: "right" }}>{t("w20.basic.shift.hours", locale)}</th>
          <th style={th}>{t("op", locale)}</th>
        </tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.shift_code}-${i}`}>
              <td style={td}>
                <input value={r.shift_code} style={{ ...inp, ...mono, width: 90 }}
                  onChange={e => patch(i, { shift_code: e.target.value.toUpperCase() })} />
              </td>
              <td style={td}><input value={s(r.shift_name)} style={{ ...inp, width: 130 }} onChange={e => patch(i, { shift_name: e.target.value })} /></td>
              <td style={td}><input value={s(r.begin_time)} style={{ ...inp, width: 84 }} onChange={e => patch(i, { begin_time: e.target.value })} /></td>
              <td style={td}><input value={s(r.end_time)} style={{ ...inp, width: 84 }} onChange={e => patch(i, { end_time: e.target.value })} /></td>
              <td style={{ ...td, textAlign: "center" }}>
                <input type="checkbox" checked={!!Number(r.cross_day)} onChange={e => patch(i, { cross_day: e.target.checked ? 1 : 0 })} />
              </td>
              <td style={{ ...td, textAlign: "right" }}>
                <input type="number" min={0} max={24} step={0.5} value={s(r.work_hours)}
                  style={{ ...inp, width: 90, textAlign: "right" }} onChange={e => patch(i, { work_hours: e.target.value })} />
              </td>
              <td style={td}><button onClick={() => setRows(rs => rs.filter((_, j) => j !== i))}>{t("common.delete", locale)}</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
        <button disabled={busy} onClick={() => void save()}>{t("w20.basic.shift.save", locale)}</button>
        <button onClick={() => setRows(rs => [...rs, {
          shift_code: "", shift_name: "", begin_time: "08:00", end_time: "20:00", cross_day: 0, work_hours: "10",
        }])}>{t("w20.basic.shift.add", locale)}</button>
        <span style={muted}>{t("w20.basic.shift.hint", locale)}</span>
      </div>
    </div>
  );
}

// ── 3. 产能标准 UPH（源 /plan/capmaster/list|save|delete）──
interface CapRow {
  id: number | string; line_code: string; product_code: string; process: string;
  uph?: number | string; std_headcount?: number | string; enabled?: number | string; remark?: string;
}
interface CapOpts { lines?: string[]; products?: string[]; processes?: string[] }
const CAP_BLANK = { line_code: "", product_code: "", process: "", uph: "0", std_headcount: "0", remark: "" };

function CapTab({ locale }: { locale: Locale }) {
  const [rows, setRows] = useState<CapRow[]>([]);
  const [opts, setOpts] = useState<CapOpts>({});
  const [fLine, setFLine] = useState(""); const [fProd, setFProd] = useState("");
  const [form, setForm] = useState({ ...CAP_BLANK });
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState(""); const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async (line: string, prod: string) => {
    setErr("");
    try {
      const d = await mesrjApi.get<{ rows?: CapRow[]; opts?: CapOpts }>("/plan/capmaster/list",
        { line_code: line, product_code: prod });
      setRows(d?.rows || []); if (d?.opts) setOpts(d.opts);
    } catch (ex) { setErr(errText(ex)); }
  }, []);
  useEffect(() => { void load("", ""); }, [load]);

  const addNew = () => {
    setForm({ ...CAP_BLANK, process: (opts.processes || [])[0] || "" });
    setErr(""); setOpen(true);
  };
  const edit = (r: CapRow) => {
    setForm({
      line_code: r.line_code, product_code: r.product_code, process: r.process,
      uph: s(r.uph), std_headcount: s(r.std_headcount), remark: s(r.remark),
    });
    setErr(""); setOpen(true);
  };
  const save = async () => {
    if (!(form.line_code.trim() && form.product_code.trim() && form.process.trim())) {
      setErr(t("w20.basic.cap.needKey", locale)); return;
    }
    setErr(""); setMsg(""); setBusy(true);
    try {
      const d = await mesrjMsg.post("/plan/capmaster/save", form);
      setMsg(d.msg || t("w17.saved", locale)); setOpen(false); void load(fLine, fProd);
    } catch (ex) { setErr(errText(ex)); }
    finally { setBusy(false); }
  };
  const del = async (r: CapRow) => {
    if (!window.confirm(t("w20.basic.cap.delConfirm", locale))) return;
    setErr(""); setMsg("");
    try {
      const d = await mesrjMsg.post("/plan/capmaster/delete", { id: r.id });
      setMsg(d.msg || t("w17.saved", locale)); void load(fLine, fProd);
    } catch (ex) { setErr(errText(ex)); }
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
        <select value={fProd} onChange={e => setFProd(e.target.value)} style={inp}>
          <option value="">{t("w20.basic.cap.allProducts", locale)}</option>
          {(opts.products || []).map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={fLine} onChange={e => setFLine(e.target.value)} style={inp}>
          <option value="">{t("w20.basic.cap.allLines", locale)}</option>
          {(opts.lines || []).map(l => <option key={l} value={l}>{l}</option>)}
        </select>
        <button onClick={() => void load(fLine, fProd)}>{t("search", locale)}</button>
        <span style={{ flex: 1 }} />
        <button onClick={addNew}>{t("w20.basic.cap.add", locale)}</button>
        <button onClick={() => void load(fLine, fProd)}>{t("refresh", locale)}</button>
      </div>
      <Err msg={err} /><Ok msg={msg} />
      {open && (
        <div style={editor}>
          <Field label={t("w20.basic.cap.line", locale)} value={form.line_code}
            onChange={v => setForm(f => ({ ...f, line_code: v }))} ph="L001" />
          <Field label={t("model", locale)} value={form.product_code}
            onChange={v => setForm(f => ({ ...f, product_code: v }))} ph="EPS18R1G-36" width={190} />
          <Pick label={t("shift.field.process", locale)} value={form.process} opts={opts.processes || []}
            onChange={v => setForm(f => ({ ...f, process: v }))} />
          <Field label={t("w17.ultra.uph", locale)} value={form.uph} type="number"
            onChange={v => setForm(f => ({ ...f, uph: v }))} width={90} />
          <Field label={t("w20.basic.c.headcount", locale)} value={form.std_headcount} type="number"
            onChange={v => setForm(f => ({ ...f, std_headcount: v }))} width={90} />
          <Field label={t("remark", locale)} value={form.remark}
            onChange={v => setForm(f => ({ ...f, remark: v }))} width={260} />
          <div>
            <button disabled={busy} onClick={() => void save()}>{t("save", locale)}</button>
            <button style={{ marginLeft: 6 }} onClick={() => setOpen(false)}>{t("cancel", locale)}</button>
          </div>
        </div>
      )}
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead><tr>
          <th style={th}>{t("w20.basic.cap.line", locale)}</th>
          <th style={th}>{t("model", locale)}</th>
          <th style={th}>{t("shift.field.process", locale)}</th>
          <th style={{ ...th, textAlign: "right" }}>{t("w17.ultra.uph", locale)}</th>
          <th style={{ ...th, textAlign: "right" }}>{t("w20.basic.c.headcount", locale)}</th>
          <th style={{ ...th, textAlign: "right" }}>{t("w20.basic.c.perShift", locale)}</th>
          <th style={th}>{t("op", locale)}</th>
        </tr></thead>
        <tbody>
          {!rows.length && <tr><td style={td} colSpan={7}>{t("w20.basic.cap.empty", locale)}</td></tr>}
          {rows.map(r => (
            <tr key={String(r.id)}>
              <td style={{ ...td, ...mono }}>{r.line_code}</td>
              <td style={td}>{r.product_code}</td>
              <td style={{ ...td, fontWeight: 600 }}>{r.process}</td>
              <td style={{ ...td, textAlign: "right" }}>{s(r.uph)}</td>
              <td style={{ ...td, textAlign: "right" }}>{s(r.std_headcount)}</td>
              <td style={{ ...td, textAlign: "right" }}>{Math.round(Number(r.uph || 0) * 10)}</td>
              <td style={td}>
                <button onClick={() => edit(r)}>{t("common.edit", locale)}</button>
                <button style={{ marginLeft: 6 }} onClick={() => void del(r)}>{t("common.delete", locale)}</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ ...muted, marginTop: 8 }}>{t("w20.basic.cap.hint", locale)}</div>
    </div>
  );
}

// ── 4. 关键参数（源 /cfg/basic/params + /save，分组编辑器 + 批量保存）──
interface BasicParam {
  key: string; name?: string; type?: string; unit?: string; default?: string; desc?: string; value?: string;
}
interface BasicParamGroup { group: string; items?: BasicParam[] }

function ParamTab({ locale }: { locale: Locale }) {
  const [groups, setGroups] = useState<BasicParamGroup[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [err, setErr] = useState(""); const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setErr("");
    try {
      const d = await mesrjApi.get<{ groups?: BasicParamGroup[] }>("/cfg/basic/params");
      setGroups(d?.groups || []); setEdits({});
    } catch (ex) { setErr(errText(ex)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const dirty = Object.keys(edits).length;
  const save = async () => {
    setErr(""); setMsg(""); setBusy(true);
    try {
      const d = await mesrjMsg.post("/cfg/basic/params/save", {
        items: Object.entries(edits).map(([key, value]) => ({ key, value })),
      });
      setMsg(d.msg || t("w17.saved", locale)); void load();
    } catch (ex) { setErr(errText(ex)); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <Err msg={err} /><Ok msg={msg} />
      {groups.map(g => (
        <div key={g.group} style={box}>
          <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 13, color: "#0f6e56" }}>{g.group}</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead><tr>
              <th style={{ ...th, width: 260 }}>{t("w20.basic.param.item", locale)}</th>
              <th style={{ ...th, width: 300 }}>{t("w19.param.value", locale)}</th>
              <th style={th}>{t("w19.param.remark", locale)}</th>
            </tr></thead>
            <tbody>
              {(g.items || []).map(it => {
                const val = edits[it.key] !== undefined ? edits[it.key] : s(it.value);
                const changed = edits[it.key] !== undefined && edits[it.key] !== s(it.value);
                const setVal = (v: string) => setEdits(x => ({ ...x, [it.key]: v }));
                return (
                  <tr key={it.key}>
                    <td style={td}>
                      <b>{it.name || it.key}</b>
                      <div style={{ ...muted, ...mono, fontSize: 11 }}>{it.key}</div>
                    </td>
                    <td style={td}>
                      {it.type === "bool" ? (
                        <select value={val} onChange={e => setVal(e.target.value)}
                          style={{ padding: "4px 6px", background: changed ? "#fffbeb" : undefined }}>
                          <option value="1">{t("common.enabled.y", locale)}</option>
                          <option value="0">{t("common.enabled.n", locale)}</option>
                        </select>
                      ) : (
                        <>
                          <input type={it.type === "num" ? "number" : "text"} value={val} onChange={e => setVal(e.target.value)}
                            style={{ padding: "4px 6px", width: it.unit ? 150 : 260, background: changed ? "#fffbeb" : undefined }} />
                          {it.unit ? <span style={{ ...muted, marginLeft: 6 }}>{it.unit}</span> : null}
                        </>
                      )}
                    </td>
                    <td style={{ ...td, color: "#64748b", lineHeight: 1.6 }}>{it.desc || ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button disabled={!dirty || busy} onClick={() => void save()}>{t("w20.basic.param.save", locale)}{dirty ? ` (${dirty})` : ""}</button>
        <button onClick={() => void load()}>{t("refresh", locale)}</button>
        <span style={muted}>{t("w20.basic.param.hint", locale)}</span>
      </div>
    </div>
  );
}

const BASIC_TABS: { k: BasicTab; name: string; desc: string }[] = [
  { k: "process", name: "w20.basic.tab.process", desc: "w20.basic.tab.processDesc" },
  { k: "shift", name: "w20.basic.tab.shift", desc: "w20.basic.tab.shiftDesc" },
  { k: "cap", name: "w20.basic.tab.cap", desc: "w20.basic.tab.capDesc" },
  { k: "param", name: "w20.basic.tab.param", desc: "w20.basic.tab.paramDesc" },
];

export function BasicDataView({ locale }: { locale: Locale }) {
  const [tab, setTab] = useState<BasicTab>("process");
  const hit = BASIC_TABS.filter(x => x.k === tab)[0];
  return (
    <div>
      <div style={{ ...box, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <b style={{ fontSize: 14, marginRight: 6 }}>{t("menu.cfg.basic", locale)}</b>
        {BASIC_TABS.map(x => (
          <button key={x.k} onClick={() => setTab(x.k)}
            style={x.k === tab ? { background: "var(--accent, #4f46e5)", color: "#fff" } : undefined}>
            {t(x.name, locale)}
          </button>
        ))}
      </div>
      {hit && <div style={{ ...muted, marginBottom: 10 }}>{t(hit.desc, locale)}</div>}
      {tab === "process" && <ProcessTab locale={locale} />}
      {tab === "shift" && <ShiftTab locale={locale} />}
      {tab === "cap" && <CapTab locale={locale} />}
      {tab === "param" && <ParamTab locale={locale} />}
    </div>
  );
}

// ============================================================================
// sys.info 系统信息
// ============================================================================
interface SysInfoBody {
  sys_name?: string; version?: string; factory?: string; db?: string;
  port?: number | string; started_at?: string; counts?: Record<string, number>;
}
interface HealthRow {
  device_id?: string; device_name?: string; device_type?: string; status?: string;
  last_heartbeat_at?: string; healthy?: boolean;
}
interface ItfRow {
  id?: number | string; api_name?: string; base_url?: string; api_key?: string;
  timeout?: number | string; enabled?: number | string; use_proxy?: number | string;
  remark?: string; updated_at?: string;
}
interface TestRow {
  id?: number | string; sn?: string; equip_code?: string; station_code?: string; mo_no?: string;
  param_key?: string; param_val?: string; result?: string; test_time?: string;
}

export function SysInfoView({ locale }: { locale: Locale }) {
  const [info, setInfo] = useState<SysInfoBody | null>(null);
  const [health, setHealth] = useState<HealthRow[]>([]);
  const [itf, setItf] = useState<ItfRow | null>(null);
  const [cfgBaseUrl, setCfgBaseUrl] = useState("");
  const [testRows, setTestRows] = useState<TestRow[]>([]);
  const [testSn, setTestSn] = useState("");
  const [err, setErr] = useState("");
  const [itfMsg, setItfMsg] = useState(""); const [itfOk, setItfOk] = useState(true);
  const [testing, setTesting] = useState(false); const [itfBusy, setItfBusy] = useState(false);

  const load = useCallback(async () => {
    setErr("");
    const [hv, ic] = await Promise.all([
      mesrjApi.get<HealthRow[]>("/exec/device/health").catch(() => [] as HealthRow[]),
      mesrjApi.get<{ rows?: ItfRow[]; cfg_base_url?: string }>("/itf/config").catch(() => null),
    ]);
    try {
      setInfo(await mesrjApi.get<SysInfoBody>("/sysinfo"));
      setHealth(hv || []);
      const row = (ic?.rows || [])[0];
      // 源屏：无记录时用默认值开一张新单（保存即新增）
      setItf(row || { api_name: t("w20.sys.itf.defaultName", locale), timeout: "10", enabled: 1, use_proxy: 0 });
      setCfgBaseUrl(ic?.cfg_base_url || "");
    } catch (ex) { setErr(errText(ex)); }
  }, [locale]);
  const loadTests = useCallback(async (sn: string) => {
    setErr("");
    try {
      const d = await mesrjApi.get<{ rows?: TestRow[] }>("/cfg/machinetest",
        sn.trim() ? { keyword: sn.trim(), size: 50 } : { size: 20 });
      setTestRows(d?.rows || []);
    } catch (ex) { setErr(errText(ex)); }
  }, []);
  useEffect(() => { void load(); void loadTests(""); }, [load, loadTests]);

  const saveItf = async () => {
    setItfMsg(""); setItfBusy(true);
    try {
      const d = await mesrjMsg.post("/itf/config/save", { ...(itf || {}) });
      setItfOk(true); setItfMsg(d.msg || t("w17.saved", locale)); void load();
    } catch (ex) { setItfOk(false); setItfMsg(errText(ex)); }
    finally { setItfBusy(false); }
  };
  const testItf = async () => {
    setItfMsg(t("w20.sys.itf.testing", locale)); setItfOk(true); setTesting(true);
    try {
      const d = await mesrjMsg.post<{ cost_ms?: number }>("/itf/config/test",
        { base_url: s(itf?.base_url), use_proxy: Number(itf?.use_proxy) ? 1 : 0 });
      setItfOk(true);
      setItfMsg(`${d.msg || t("w20.sys.itf.ok", locale)}${d.data?.cost_ms !== undefined ? `（${d.data.cost_ms} ms）` : ""}`);
    } catch (ex) { setItfOk(false); setItfMsg(errText(ex)); }
    finally { setTesting(false); }
  };

  const counts = Object.entries(info?.counts || {});
  const online = health.filter(r => r.healthy).length;
  return (
    <div>
      <Err msg={err} />
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        <div style={{ ...box, flex: "1 1 320px", minWidth: 300 }}>
          <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 13 }}>{t("w20.sys.run", locale)}</div>
          {!info ? <div style={muted}>{t("loading", locale)}</div> : (
            <div style={{ fontSize: 12, lineHeight: 2 }}>
              <div>{t("w20.sys.name", locale)}：<b>{info.sys_name || "—"}</b></div>
              <div>{t("w20.sys.version", locale)}：<b>{info.version || "—"}</b></div>
              {info.factory ? <div>{t("w20.sys.factory", locale)}：<b>{info.factory}</b></div> : null}
              <div>{t("w20.sys.started", locale)}：<b>{dt(info.started_at) || "—"}</b></div>
              <div>{t("w20.sys.port", locale)}：<b>{s(info.port) || "—"}</b></div>
              <div>{t("w20.sys.db", locale)}：<span style={{ ...mono, fontSize: 11 }}>{info.db || "—"}</span></div>
            </div>
          )}
        </div>
        <div style={{ ...box, flex: "1 1 320px", minWidth: 300 }}>
          <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 13 }}>{t("w20.sys.counts", locale)}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, fontSize: 12 }}>
            {!counts.length && <span style={muted}>{t("no_data", locale)}</span>}
            {counts.map(([k, v]) => (
              <div key={k} style={{ minWidth: 92 }}>
                <div style={{ color: "#64748b" }}>{k}</div>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{v}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={box}>
        <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 13 }}>{t("w20.sys.itf", locale)}</div>
        <div style={{ ...muted, marginBottom: 10 }}>{t("w20.sys.itfDesc", locale)}</div>
        {!itf ? <div style={muted}>{t("loading", locale)}</div> : (
          <div>
            <Field label={t("cfg.dict.name", locale)} value={s(itf.api_name)} width={200}
              onChange={v => setItf(x => ({ ...(x || {}), api_name: v }))} />
            <Field label={t("w20.sys.itf.baseUrl", locale)} value={s(itf.base_url)} width={360}
              ph="http://192.168.1.100:8081" onChange={v => setItf(x => ({ ...(x || {}), base_url: v }))} />
            <Field label="X-Api-Key" value={s(itf.api_key)} width={200}
              onChange={v => setItf(x => ({ ...(x || {}), api_key: v }))} />
            <Field label={t("w20.sys.itf.timeout", locale)} value={s(itf.timeout)} type="number" width={80}
              onChange={v => setItf(x => ({ ...(x || {}), timeout: v }))} />
            <Check label={t("common.enabled.y", locale)} value={Number(itf.enabled ?? 1) ? true : false}
              onChange={v => setItf(x => ({ ...(x || {}), enabled: v ? 1 : 0 }))} />
            <Check label={t("w20.sys.itf.useProxy", locale)} value={Number(itf.use_proxy) ? true : false}
              onChange={v => setItf(x => ({ ...(x || {}), use_proxy: v ? 1 : 0 }))} />
            <div>
              <Field label={t("remark", locale)} value={s(itf.remark)} width={420}
                onChange={v => setItf(x => ({ ...(x || {}), remark: v }))} />
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <button disabled={itfBusy} onClick={() => void saveItf()}>{t("save", locale)}</button>
              <button disabled={testing} onClick={() => void testItf()}>{t("w20.sys.itf.test", locale)}</button>
              {itf.updated_at ? <span style={muted}>{t("w20.sys.itf.updatedAt", locale)}：{dt(itf.updated_at)}</span> : null}
              <span style={{ flex: 1 }} />
              {cfgBaseUrl ? (
                <span style={muted}>
                  {t("w20.sys.selfUrl", locale)}：
                  <a href={cfgBaseUrl} target="_blank" rel="noreferrer" style={{ ...mono, fontSize: 11 }}>{cfgBaseUrl}</a>
                </span>
              ) : null}
            </div>
            {itfMsg && <div style={{ marginTop: 8, fontSize: 12, color: itfOk ? "#15803d" : "#b91c1c" }}>{itfMsg}</div>}
          </div>
        )}
      </div>

      <div style={box}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
          <b style={{ fontSize: 13 }}>{t("w20.sys.health", locale)}</b>
          <span style={muted}>{t("w20.sys.healthDesc", locale)}</span>
          <span style={{ flex: 1 }} />
          <span style={{ ...muted, color: online ? "#15803d" : "#b45309" }}>
            {t("w20.sys.health.online", locale)} {online} / {health.length}
          </span>
          <button onClick={() => void load()}>{t("refresh", locale)}</button>
        </div>
        {!health.length ? <div style={muted}>{t("no_data", locale)}</div> : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead><tr>
              <th style={th}>{t("w20.sys.health.id", locale)}</th>
              <th style={th}>{t("w20.sys.health.name", locale)}</th>
              <th style={th}>{t("w18.c.deviceType", locale)}</th>
              <th style={th}>{t("status", locale)}</th>
              <th style={th}>{t("w6c.field.last_heartbeat", locale)}</th>
              <th style={{ ...th, textAlign: "center" }}>{t("w6c.field.healthy", locale)}</th>
            </tr></thead>
            <tbody>
              {health.map((r, i) => (
                <tr key={`${r.device_id}-${i}`}>
                  <td style={{ ...td, ...mono }}>{s(r.device_id)}</td>
                  <td style={td}>{s(r.device_name)}</td>
                  <td style={td}>{s(r.device_type)}</td>
                  <td style={td}>{s(r.status)}</td>
                  <td style={{ ...td, ...mono, fontSize: 11 }}>{dt(r.last_heartbeat_at) || "—"}</td>
                  <td style={{ ...td, textAlign: "center", color: r.healthy ? "#15803d" : "#b91c1c" }}>
                    {r.healthy ? t("common.enabled.y", locale) : t("common.enabled.n", locale)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div style={box}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
          <b style={{ fontSize: 13 }}>{t("w20.sys.test", locale)}</b>
          <input value={testSn} onChange={e => setTestSn(e.target.value)} placeholder={t("w20.sys.test.snPh", locale)}
            style={{ ...inp, ...mono, width: 200 }} onKeyDown={e => { if (e.key === "Enter") void loadTests(testSn); }} />
          <button onClick={() => void loadTests(testSn)}>{t("search", locale)}</button>
          <span style={{ flex: 1 }} />
          <span style={muted}>{t("common.total", locale)} {testRows.length} {t("common.items", locale)}</span>
        </div>
        {!testRows.length ? <div style={muted}>{t("no_data", locale)}</div> : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead><tr>
              <th style={th}>SN</th>
              <th style={th}>{t("machine", locale)}</th>
              <th style={th}>{t("m_station", locale)}</th>
              <th style={th}>{t("mo", locale)}</th>
              <th style={th}>{t("cfg.machinetest.param_key", locale)}</th>
              <th style={th}>{t("cfg.machinetest.param_val", locale)}</th>
              <th style={th}>{t("w20.sys.test.result", locale)}</th>
              <th style={th}>{t("w20.sys.test.time", locale)}</th>
            </tr></thead>
            <tbody>
              {testRows.map((r, i) => (
                <tr key={`${r.id}-${i}`}>
                  <td style={{ ...td, ...mono }}>{s(r.sn)}</td>
                  <td style={td}>{s(r.equip_code)}</td>
                  <td style={td}>{s(r.station_code)}</td>
                  <td style={{ ...td, ...mono, fontSize: 11 }}>{s(r.mo_no)}</td>
                  <td style={{ ...td, ...mono, fontSize: 11 }}>{s(r.param_key)}</td>
                  <td style={td}>{s(r.param_val)}</td>
                  <td style={{ ...td, color: r.result === "NG" ? "#b91c1c" : "#15803d" }}>{s(r.result)}</td>
                  <td style={{ ...td, ...mono, fontSize: 11 }}>{dt(r.test_time)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
