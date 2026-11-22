// ============================================================================
// MES-ruijing W19 前端 —— Tier-1 补齐里「通用表格引擎套不进」的两屏
//   sys.param   系统参数：后端返回 [{group, items[]}] 分组结构，不是平表 → 分组编辑器
//   qlt.aqlstd  AQL 检验标准：后端返回一个对象映射（5 个 oqc.aql_* 参数）+ 速查预览
// 后端全部复用 mesrj 既有接口（/sys/param/list|save、/oqc/aql/std、/oqc/aql/preview），
// 不新增路由、不新建表。标准见 docs/grafting-standards.md §7。
// ============================================================================
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
  return <div style={{ color: "#15803d", padding: "6px 0", fontSize: 13 }}>{msg}</div>;
}

// ── 系统参数（源 sys.param：分组表格 + 就地编辑 + 批量保存）──
interface ParamItem { param_key: string; param_val: string; param_name?: string; remark?: string; updated_at?: string }
interface ParamGroup { group: string; items: ParamItem[] }

export function ParamView({ locale }: { locale: Locale }) {
  const [groups, setGroups] = useState<ParamGroup[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [err, setErr] = useState(""); const [msg, setMsg] = useState("");
  const load = useCallback(async () => {
    setErr("");
    try { setGroups(await mesrjApi.get<ParamGroup[]>("/sys/param/list")); setEdits({}); }
    catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const dirty = Object.keys(edits).length;
  const save = async () => {
    setErr(""); setMsg("");
    try {
      await mesrjApi.post("/sys/param/save", { items: edits });
      setMsg(t("w19.param.saved", locale)); setEdits({}); void load();
    } catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
  };
  return (
    <div>
      <div style={{ ...box, display: "flex", gap: 8, alignItems: "center" }}>
        <b style={{ fontSize: 14 }}>{t("menu.sys.param", locale)}</b>
        <span style={{ flex: 1 }} />
        <button onClick={() => void load()}>{t("refresh", locale)}</button>
        <button disabled={!dirty} onClick={() => void save()}>{t("save", locale)}{dirty ? ` (${dirty})` : ""}</button>
      </div>
      <Err msg={err} /><Ok msg={msg} />
      {groups.map(g => (
        <div key={g.group} style={box}>
          <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 13 }}>{g.group}</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead><tr>
              {[t("w19.param.key", locale), t("w19.param.name", locale), t("w19.param.value", locale), t("w19.param.remark", locale)].map(h => (
                <th key={h} style={{ padding: "6px 8px", borderBottom: "1px solid var(--border, #e2e8f0)", textAlign: "left" }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {(g.items || []).map(it => {
                const val = edits[it.param_key] !== undefined ? edits[it.param_key] : (it.param_val ?? "");
                const changed = edits[it.param_key] !== undefined && edits[it.param_key] !== (it.param_val ?? "");
                return (
                  <tr key={it.param_key} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "5px 8px", fontFamily: "monospace" }}>{it.param_key}</td>
                    <td style={{ padding: "5px 8px" }}>{it.param_name || ""}</td>
                    <td style={{ padding: "5px 8px" }}>
                      <input value={val} onChange={e => setEdits(x => ({ ...x, [it.param_key]: e.target.value }))}
                        style={{ width: "100%", padding: "3px 6px", background: changed ? "#fffbeb" : undefined }} />
                    </td>
                    <td style={{ padding: "5px 8px", color: "#64748b", fontSize: 11 }}>{it.remark || ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

// ── AQL 检验标准（源 qlt.aqlstd：5 参数 + 批量→抽样→Ac/Re 速查）──
type Std = Record<string, string>;
interface PreviewRow { lot_from?: number; lot_to?: number; code?: string; sample?: number; ma_ac?: number; ma_re?: number; mi_ac?: number; mi_re?: number; [k: string]: unknown }

export function AqlStdView({ locale }: { locale: Locale }) {
  const [std, setStd] = useState<Std>({});
  const [form, setForm] = useState<Std>({});
  const [lot, setLot] = useState("");
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [err, setErr] = useState(""); const [msg, setMsg] = useState("");
  const load = useCallback(async () => {
    setErr("");
    try {
      const d = await mesrjApi.get<Std>("/oqc/aql/std");
      setStd(d || {});
      setForm({
        level: d?.["oqc.aql_level"] || "II", severity: d?.["oqc.aql_severity"] || "normal",
        aql_ma: d?.["oqc.aql_ma"] || "", aql_mi: d?.["oqc.aql_mi"] || "", lot_basis: d?.["oqc.aql_lot_basis"] || "pallet",
      });
    } catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const save = async () => {
    setErr(""); setMsg("");
    try { await mesrjApi.post("/oqc/aql/std", form); setMsg(t("w19.aql.saved", locale)); void load(); }
    catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
  };
  const runPreview = async () => {
    setErr("");
    try {
      const d = await mesrjApi.get<PreviewRow[] | { rows?: PreviewRow[] }>("/oqc/aql/preview",
        { lot: lot, level: form.level, severity: form.severity });
      setPreview(Array.isArray(d) ? d : (d?.rows || []));
    } catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
  };
  const field = (k: keyof typeof form, label: string, opts?: string[]) => (
    <label style={{ fontSize: 12, marginRight: 12, display: "inline-block" }}>
      {label}
      {opts ? (
        <select value={form[k] as string} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} style={{ display: "block", marginTop: 2 }}>
          {opts.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input value={form[k] as string} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} style={{ display: "block", marginTop: 2, padding: "4px 6px", width: 110 }} />
      )}
    </label>
  );
  return (
    <div>
      <div style={box}>
        <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 13 }}>{t("menu.qlt.aqlstd", locale)}</div>
        <div style={{ marginBottom: 10 }}>
          {field("level", t("w19.aql.level", locale), ["I", "II", "III", "S-1", "S-2", "S-3", "S-4"])}
          {field("severity", t("w19.aql.severity", locale), ["tightened", "normal", "reduced"])}
          {field("aql_ma", t("w19.aql.ma", locale))}
          {field("aql_mi", t("w19.aql.mi", locale))}
          {field("lot_basis", t("w19.aql.basis", locale), ["pallet", "box", "unit"])}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={() => void save()}>{t("save", locale)}</button>
          <button onClick={() => void load()}>{t("refresh", locale)}</button>
          <span style={{ flex: 1 }} />
          <input value={lot} onChange={e => setLot(e.target.value)} type="number" placeholder={t("w19.aql.lotPh", locale)} style={{ ...inp, width: 130 }} />
          <button onClick={() => void runPreview()}>{t("w19.aql.preview", locale)}</button>
        </div>
      </div>
      <Err msg={err} /><Ok msg={msg} />
      {preview.length > 0 && (
        <div style={box}>
          <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 13 }}>{t("w19.aql.result", locale)}</div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead><tr>
                {Object.keys(preview[0]).filter(k => !k.startsWith("_")).map(k => (
                  <th key={k} style={{ padding: "6px 8px", borderBottom: "1px solid var(--border, #e2e8f0)", textAlign: "left" }}>{k}</th>
                ))}
              </tr></thead>
              <tbody>
                {preview.map((r, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    {Object.keys(r).filter(k => !k.startsWith("_")).map(k => <td key={k} style={{ padding: "5px 8px" }}>{String(r[k] ?? "")}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
