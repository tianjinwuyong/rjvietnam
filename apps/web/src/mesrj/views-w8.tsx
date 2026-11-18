// MES-ruijing W8 前端 —— AOI 看板 + 出货报告模板
// 后端路由（services/api/src/routes/mesrj.js）：
//   GET  /aoi/dash                 AOI 看板（产量 + 质量 DPPM/DPMO/TrueFail/NDF）
//   GET  /aoi/dict                 不良代码字典
//   GET  /aoi/models               机型下拉（原始程序名 + 归一映射）
//   GET  /aoi/compmap              位号映射
//   POST /aoi/compmap/import       位号映射批量导入
//   GET  /report/tpl/list          模板列表
//   POST /report/tpl/upload        上传模板
//   GET  /report/tpl/:id/cells     模板单元格
//   POST /report/tpl/:id/mapping   保存字段映射
//   POST /report/tpl/:id/enable    启用/停用
//   DEL  /report/tpl/:id           删除模板
//   GET  /report/check             生成前检查
//   POST /report/gen               生成报告（xlsx 下载）
import { useCallback, useEffect, useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { mesrjApi, MesrjApiError } from "./api";
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
async function call<T>(fn: () => Promise<T>): Promise<[T | null, string]> {
  try { return [await fn(), ""]; }
  catch (ex) { return [null, ex instanceof MesrjApiError ? ex.message : String(ex)]; }
}

// ═══ AOI 看板 ═══════════════════════════════════════════════════════════════

interface AoiSummary {
  panels: number; boards: number; points: number;
  points_cov: number; points_src: string;
  ng_boards: number; ng_panels: number; ndf_panels: number; final_ng_panels: number;
  ok_boards: number; ndf_boards: number; tf_boards: number;
  first_dppm: number; dpmo: number | null; dpmo_tf: number | null;
  dpmo_first: number | null; dpmo_false: number | null;
  ng_comps: number; comps: number; ng_comps_pt: number;
  ng_comps_tf: number; ng_comps_false: number; tf_cov: number;
  recheck_panels: number; uph: number | null; uph_panel: number | null;
  uph_range: number | null; ct_avg: number | null; ct_hours: number;
  first_yield: number; ng_rate: number; final_ng_rate: number; ndf_rate: number;
  ok_panels: number; ng_only_upload: number;
  station: string; points_borrow: string;
  by_station: Array<{ station: string; boards: number; ng_boards: number; dppm: number; dpmo: number | null }>;
}
interface AoiDash {
  by: string;
  range: { from: string; to: string; label: string; days: string };
  summary: AoiSummary;
  daily: Array<{ d: string; panels: number; boards: number; ng_boards: number; dppm: number; ng_rate: number }>;
  models: Array<{ model: string; boards: number; ng_boards: number; dppm: number; dpmo: number | null }>;
  ng_types: Array<{ code: string; label: string; name_zh: string; category: string; n: number; tf: number; ndf: number }>;
  ng_comps: Array<{ designator: string; label: string; sub?: string; type: string; n: number; tf: number }>;
  ndf_comps: Array<{ designator: string; label: string; n: number; ndf: number }>;
  comp_cov: number;
  comp_map: { model: string; rows: number; mapped_in_top: number };
  no_points: Array<{ model: string; boards: number }>;
  recent: Array<{ id: number; test_time: string; pcb_sn: string; project_name: string; final_result: string; file_name: string }>;
  devices: string[];
  model_opts: string[];
  program_opts: string[];
  unmapped: string[];
}

export function AoiDashView({ locale }: { locale: Locale }) {
  const [days, setDays] = useState("7");
  const [station, setStation] = useState("SMT-AOI");
  const [device, setDevice] = useState("");
  const [model, setModel] = useState("");
  const [data, setData] = useState<AoiDash | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    const [d, e] = await call(() => mesrjApi.get<AoiDash>("/aoi/dash", {
      days, station, device, model,
    }));
    setBusy(false);
    if (e) { setErr(e); setData(null); return; }
    setErr(""); setData(d);
  }, [days, station, device, model]);
  useEffect(() => { void load(); }, [load]);

  const s = data?.summary;
  const card = (label: string, value: string | number, sub?: string, color?: string) => (
    <div style={{ flex: "1 1 150px", minWidth: 150, padding: "12px 14px", border: "1px solid var(--border, #e2e8f0)", borderRadius: 10 }}>
      <div style={{ fontSize: 12, color: "#64748b" }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, marginTop: 2, color: color || "#0f172a" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "#94a3b8" }}>{sub}</div>}
    </div>
  );

  return (
    <div>
      <div style={{ ...box, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 13 }}>{t("aoi.dash.days", locale)}</span>
        <select value={days} onChange={e => setDays(e.target.value)} style={inp}>
          {["1", "7", "30", "90"].map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <select value={station} onChange={e => setStation(e.target.value)} style={inp}>
          <option value="SMT-AOI">SMT-AOI</option>
          <option value="SPI">SPI</option>
          <option value="WS-AOI">WS-AOI</option>
          <option value="ALL">{t("aoi.dash.all_station", locale)}</option>
        </select>
        <select value={device} onChange={e => setDevice(e.target.value)} style={{ ...inp, minWidth: 150 }}>
          <option value="">{t("aoi.dash.all_device", locale)}</option>
          {(data?.devices || []).map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <select value={model} onChange={e => setModel(e.target.value)} style={{ ...inp, minWidth: 180 }}>
          <option value="">{t("aoi.dash.all_model", locale)}</option>
          {(data?.model_opts || []).map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <button onClick={() => void load()} disabled={busy}>{t("search", locale)}</button>
        {data && <span style={{ fontSize: 12, color: "#94a3b8" }}>{data.range.label}</span>}
      </div>
      <Err msg={err} />

      {s && (
        <>
          <div style={{ ...box, display: "flex", gap: 12, flexWrap: "wrap" }}>
            {card(t("aoi.dash.panels", locale), s.panels, t("aoi.dash.boards", locale) + ` ${s.boards}`)}
            {card(t("aoi.dash.yield", locale), `${s.first_yield}%`, t("aoi.dash.ng_rate", locale) + ` ${s.ng_rate}%`, "#15803d")}
            {card(t("aoi.dash.dppm", locale), s.first_dppm, t("aoi.dash.dppm_first", locale))}
            {card(t("aoi.dash.dpmo_tf", locale), s.dpmo_tf ?? "-", t("aoi.dash.dpmo_tf_sub", locale),
              (s.dpmo_tf ?? 0) > 500 ? "#b91c1c" : undefined)}
            {card(t("aoi.dash.dpmo_false", locale), s.dpmo_false ?? "-", t("aoi.dash.dpmo_false_sub", locale))}
            {card(t("aoi.dash.uph", locale), s.uph ?? "-", t("aoi.dash.uph_sub", locale) + ` ${s.ct_avg ?? "-"}s`)}
          </div>

          {s.ng_only_upload === 1 && (
            <div style={{ ...box, fontSize: 13, color: "#b45309" }}>
              ⚠ {t("aoi.dash.ng_only", locale)}
            </div>
          )}
          {s.recheck_panels > 0 && (
            <div style={{ ...box, fontSize: 13, color: "#b45309" }}>
              ⚠ {t("aoi.dash.recheck", locale)}：{s.recheck_panels}
            </div>
          )}
          {s.points_cov < 100 && (
            <div style={{ ...box, fontSize: 13, color: "#b45309" }}>
              ⚠ {t("aoi.dash.points_cov", locale)}：{s.points_cov}%（{t("aoi.dash.points_src", locale)}：{s.points_src}）
              {(data?.no_points || []).length > 0 && (
                <>
                  <br />{t("aoi.dash.no_points", locale)}：
                  {data!.no_points.map(n => `${n.model}（${n.boards}）`).join("、")}
                </>
              )}
            </div>
          )}
          {s.points_borrow && (
            <div style={{ fontSize: 12, color: "#64748b", paddingBottom: 8 }}>
              {t("aoi.dash.borrow", locale)}：{s.points_borrow}
            </div>
          )}

          {/* 按工位 */}
          {(s.by_station || []).length > 0 && (
            <div style={box}>
              <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 14 }}>{t("aoi.dash.by_station", locale)}</div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead><tr>
                  {[t("aoi.dash.station", locale), t("aoi.dash.boards", locale),
                    t("aoi.dash.ng_boards", locale), t("aoi.dash.dppm", locale),
                    t("aoi.dash.dpmo_first", locale)].map(h => (
                    <th key={h} style={{ padding: "6px 10px", borderBottom: "1px solid var(--border, #e2e8f0)", textAlign: "left" }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {s.by_station.map(b => (
                    <tr key={b.station}>
                      <td style={{ padding: "5px 10px", borderBottom: "1px solid #f1f5f9" }}>{b.station}</td>
                      <td style={{ padding: "5px 10px", borderBottom: "1px solid #f1f5f9" }}>{b.boards}</td>
                      <td style={{ padding: "5px 10px", borderBottom: "1px solid #f1f5f9", color: "#b91c1c" }}>{b.ng_boards}</td>
                      <td style={{ padding: "5px 10px", borderBottom: "1px solid #f1f5f9" }}>{b.dppm}</td>
                      <td style={{ padding: "5px 10px", borderBottom: "1px solid #f1f5f9" }}>{b.dpmo ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 按日 */}
          {(data?.daily || []).length > 0 && (
            <div style={box}>
              <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 14 }}>{t("aoi.dash.daily", locale)}</div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead><tr>
                  {[t("aoi.dash.date", locale), t("aoi.dash.panels", locale), t("aoi.dash.boards", locale),
                    t("aoi.dash.ng_boards", locale), t("aoi.dash.dppm", locale),
                    t("aoi.dash.ng_rate", locale)].map(h => (
                    <th key={h} style={{ padding: "6px 10px", borderBottom: "1px solid var(--border, #e2e8f0)", textAlign: "left" }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {data!.daily.map(d => (
                    <tr key={d.d}>
                      <td style={{ padding: "4px 10px", borderBottom: "1px solid #f1f5f9" }}>{d.d}</td>
                      <td style={{ padding: "4px 10px", borderBottom: "1px solid #f1f5f9" }}>{d.panels}</td>
                      <td style={{ padding: "4px 10px", borderBottom: "1px solid #f1f5f9" }}>{d.boards}</td>
                      <td style={{ padding: "4px 10px", borderBottom: "1px solid #f1f5f9", color: "#b91c1c" }}>{d.ng_boards}</td>
                      <td style={{ padding: "4px 10px", borderBottom: "1px solid #f1f5f9" }}>{d.dppm}</td>
                      <td style={{ padding: "4px 10px", borderBottom: "1px solid #f1f5f9" }}>{d.ng_rate}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 机型 + 不良类型 */}
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            {(data?.models || []).length > 0 && (
              <div style={{ ...box, flex: "1 1 320px" }}>
                <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 14 }}>{t("aoi.dash.by_model", locale)}</div>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead><tr>
                    {[t("aoi.dash.model", locale), t("aoi.dash.boards", locale),
                      t("aoi.dash.ng_boards", locale), t("aoi.dash.dppm", locale)].map(h => (
                      <th key={h} style={{ padding: "5px 8px", borderBottom: "1px solid var(--border, #e2e8f0)", textAlign: "left" }}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {data!.models.map(m => (
                      <tr key={m.model}>
                        <td style={{ padding: "4px 8px", borderBottom: "1px solid #f1f5f9" }}>{m.model}</td>
                        <td style={{ padding: "4px 8px", borderBottom: "1px solid #f1f5f9" }}>{m.boards}</td>
                        <td style={{ padding: "4px 8px", borderBottom: "1px solid #f1f5f9", color: "#b91c1c" }}>{m.ng_boards}</td>
                        <td style={{ padding: "4px 8px", borderBottom: "1px solid #f1f5f9" }}>{m.dppm}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {(data?.ng_types || []).length > 0 && (
              <div style={{ ...box, flex: "1 1 320px" }}>
                <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 14 }}>{t("aoi.dash.ng_types", locale)}</div>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead><tr>
                    {[t("aoi.dash.defect", locale), t("aoi.dash.n", locale),
                      t("aoi.dash.tf", locale), t("aoi.dash.ndf", locale)].map(h => (
                      <th key={h} style={{ padding: "5px 8px", borderBottom: "1px solid var(--border, #e2e8f0)", textAlign: "left" }}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {data!.ng_types.map(x => (
                      <tr key={x.code}>
                        <td style={{ padding: "4px 8px", borderBottom: "1px solid #f1f5f9" }}>
                          {x.label}<span style={{ color: "#94a3b8", fontSize: 11 }}>（{x.code}）</span>
                        </td>
                        <td style={{ padding: "4px 8px", borderBottom: "1px solid #f1f5f9" }}>{x.n}</td>
                        <td style={{ padding: "4px 8px", borderBottom: "1px solid #f1f5f9", color: "#b91c1c" }}>{x.tf}</td>
                        <td style={{ padding: "4px 8px", borderBottom: "1px solid #f1f5f9", color: "#b45309" }}>{x.ndf}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* 最近 NG */}
          {(data?.recent || []).length > 0 && (
            <div style={box}>
              <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 14 }}>{t("aoi.dash.recent_ng", locale)}</div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead><tr>
                  {[t("aoi.dash.time", locale), "SN", t("aoi.dash.program", locale),
                    t("aoi.dash.result", locale)].map(h => (
                    <th key={h} style={{ padding: "5px 8px", borderBottom: "1px solid var(--border, #e2e8f0)", textAlign: "left" }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {data!.recent.slice(0, 20).map(r => (
                    <tr key={r.id}>
                      <td style={{ padding: "4px 8px", borderBottom: "1px solid #f1f5f9" }}>{r.test_time}</td>
                      <td style={{ padding: "4px 8px", borderBottom: "1px solid #f1f5f9" }}>{r.pcb_sn}</td>
                      <td style={{ padding: "4px 8px", borderBottom: "1px solid #f1f5f9" }}>{r.project_name}</td>
                      <td style={{ padding: "4px 8px", borderBottom: "1px solid #f1f5f9", color: "#b91c1c" }}>{r.final_result}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data && data.unmapped.length > 0 && (
            <div style={{ ...box, fontSize: 12, color: "#b45309" }}>
              ⚠ {t("aoi.dash.unmapped", locale)}：{data.unmapped.join("、")}
              <br />{t("aoi.dash.unmapped_hint", locale)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ═══ 出货报告模板 ═══════════════════════════════════════════════════════════

interface TplRow {
  id: number; tpl_code: string; tpl_name: string; kind: string;
  file_name: string; sheets: string[]; enabled: number;
  remark: string; created_by: string; created_at: string;
  mapping?: Record<string, Record<string, string>>;
}
interface TplCells {
  rows: Array<{ sheet: string; cell: string; value: string }>;
  fields: Array<{ key: string; label: string }>;
  editable: Array<{ key: string; label: string }>;
}

export function ReportTplView({ locale }: { locale: Locale }) {
  const [rows, setRows] = useState<TplRow[]>([]);
  const [kinds, setKinds] = useState<Array<{ key: string; name: string }>>([]);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const [sel, setSel] = useState<TplRow | null>(null);
  const [cells, setCells] = useState<TplCells | null>(null);
  const [mapping, setMapping] = useState<Record<string, Record<string, string>>>({});
  const [sheet, setSheet] = useState("");

  // 上传
  const [upName, setUpName] = useState("");
  const [upKind, setUpKind] = useState("coc");
  const [upFile, setUpFile] = useState<File | null>(null);

  // 生成
  const [poNo, setPoNo] = useState("");
  const [pre, setPre] = useState<{
  ok: boolean; warnings: string[]; fields: Record<string, unknown>;
  editable: Array<{ key: string; label: string }>;
} | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const [d, e] = await call(() => mesrjApi.get<{ rows: TplRow[]; kinds: Array<{ key: string; name: string }> }>(
      "/report/tpl/list"));
    if (e) { setErr(e); return; }
    setErr(""); setRows(d?.rows ?? []);
    if (d?.kinds) setKinds(d.kinds);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const openTpl = async (r: TplRow) => {
    setSel(r); setSheet(r.sheets?.[0] || ""); setCells(null); setMapping({});
    const [d, e] = await call(() => mesrjApi.get<TplCells>(`/report/tpl/${r.id}/cells`));
    if (e) { setErr(e); return; }
    setErr(""); setCells(d);
    // 载入已保存的映射
    const [t2] = await call(() => mesrjApi.get<TplRow>(`/report/tpl/${r.id}`));
    if (t2) setMapping(t2.mapping || {});
  };

  const upload = async () => {
    if (!upFile) { setErr(t("report.tpl.need_file", locale)); return; }
    setBusy(true); setErr(""); setMsg("");
    const buf = await upFile.arrayBuffer();
    let bin = "";
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    const [d, e] = await call(() => mesrjApi.post<TplRow>("/report/tpl/upload", {
      kind: upKind, tpl_name: upName.trim(),
      content_base64: btoa(bin),
    }));
    setBusy(false);
    if (e) { setErr(e); return; }
    setMsg(t("report.tpl.uploaded", locale));
    setUpName(""); setUpFile(null);
    await load();
  };

  const saveMapping = async () => {
    if (!sel) return;
    setBusy(true); setErr(""); setMsg("");
    const [d, e] = await call(() => mesrjApi.post<{ msg?: string }>(`/report/tpl/${sel.id}/mapping`, { mapping }));
    setBusy(false);
    if (e) { setErr(e); return; }
    setMsg(d?.msg ?? "");
    await openTpl(sel);
  };

  const toggle = async (r: TplRow) => {
    setBusy(true); setErr(""); setMsg("");
    const [d, e] = await call(() => mesrjApi.post<{ msg?: string }>(`/report/tpl/${r.id}/enable`,
      { enabled: r.enabled !== 1 }));
    setBusy(false);
    if (e) { setErr(e); return; }
    setMsg(d?.msg ?? "");
    await load();
  };

  const remove = async (r: TplRow) => {
    if (!window.confirm(t("report.tpl.delete_confirm", locale))) return;
    setBusy(true); setErr(""); setMsg("");
    const [d, e] = await call(() => mesrjApi.del<{ msg?: string }>(`/report/tpl/${r.id}`));
    setBusy(false);
    if (e) { setErr(e); return; }
    setMsg(d?.msg ?? "");
    if (sel?.id === r.id) { setSel(null); setCells(null); }
    await load();
  };

  const doCheck = async () => {
    if (!poNo.trim()) { setErr(t("report.tpl.need_po", locale)); return; }
    setBusy(true); setErr(""); setMsg("");
    const [d, e] = await call(() => mesrjApi.get<{
      ok: boolean; warnings: string[]; fields: Record<string, unknown>;
      editable: Array<{ key: string; label: string }>;
    }>("/report/check", { po_no: poNo.trim() }));
    setBusy(false);
    if (e) { setErr(e); return; }
    setPre(d);
    setOverrides({});
  };

  const gen = async () => {
    if (!sel) { setErr(t("report.tpl.need_tpl", locale)); return; }
    setBusy(true); setErr(""); setMsg("");
    try {
      const resp = await fetch(
        `${(await import("../api/client")).API_BASE}/api/mesrj/report/gen`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(await import("../api/client")).authStorage.getToken()
              ? { Authorization: `Bearer ${(await import("../api/client")).authStorage.getToken()}` }
              : {},
          },
          body: JSON.stringify({ tpl_id: sel.id, po_no: poNo.trim(), overrides }),
        });
      if (!resp.ok) {
        const j = await resp.json().catch(() => ({}));
        setErr(j.msg || `HTTP ${resp.status}`);
        return;
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${sel.kind.toUpperCase()}_${poNo.trim()}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      setMsg(t("report.tpl.generated", locale));
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const setCellField = (sh: string, cell: string, field: string) => {
    setMapping(m => ({
      ...m,
      [sh]: { ...(m[sh] || {}), [cell]: field },
    }));
  };

  const KIND_COLOR: Record<string, string> = { coc: "#2f5597", oqc: "#15803d", cpk: "#7c3aed" };

  return (
    <div>
      <div style={{ ...box, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div>
          <div style={{ fontSize: 12, color: "#64748b", marginBottom: 3 }}>{t("report.tpl.kind", locale)}</div>
          <select value={upKind} onChange={e => setUpKind(e.target.value)} style={inp}>
            {(kinds.length ? kinds : [{ key: "coc", name: "COC" }]).map(k => (
              <option key={k.key} value={k.key}>{k.name}</option>
            ))}
          </select>
        </div>
        <div>
          <div style={{ fontSize: 12, color: "#64748b", marginBottom: 3 }}>{t("report.tpl.name", locale)}</div>
          <input value={upName} onChange={e => setUpName(e.target.value)}
            placeholder={t("report.tpl.name_ph", locale)} style={{ ...inp, width: 200 }} />
        </div>
        <div>
          <div style={{ fontSize: 12, color: "#64748b", marginBottom: 3 }}>{t("report.tpl.file", locale)}</div>
          <input type="file" accept=".xlsx" onChange={e => setUpFile(e.target.files?.[0] || null)}
            style={{ fontSize: 12 }} />
        </div>
        <button onClick={() => void upload()} disabled={busy}>{t("report.tpl.upload", locale)}</button>
      </div>

      <Err msg={err} />
      <Ok msg={msg} />

      {/* 模板列表 */}
      <div style={box}>
        <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 14 }}>{t("report.tpl.list", locale)}</div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead><tr>
            {[t("report.tpl.name", locale), t("report.tpl.kind", locale), t("report.tpl.sheets", locale),
              t("report.tpl.status", locale), t("report.tpl.created_by", locale), t("common.actions", locale)].map(h => (
              <th key={h} style={{ padding: "6px 8px", borderBottom: "1px solid var(--border, #e2e8f0)", textAlign: "left" }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}>
                <td style={{ padding: "5px 8px", borderBottom: "1px solid #f1f5f9" }}>{r.tpl_name}</td>
                <td style={{ padding: "5px 8px", borderBottom: "1px solid #f1f5f9", color: KIND_COLOR[r.kind] }}>
                  {r.kind.toUpperCase()}
                </td>
                <td style={{ padding: "5px 8px", borderBottom: "1px solid #f1f5f9" }}>{(r.sheets || []).join("、")}</td>
                <td style={{ padding: "5px 8px", borderBottom: "1px solid #f1f5f9", color: r.enabled === 1 ? "#15803d" : "#94a3b8" }}>
                  {r.enabled === 1 ? t("common.enabled.y", locale) : t("common.enabled.n", locale)}
                </td>
                <td style={{ padding: "5px 8px", borderBottom: "1px solid #f1f5f9" }}>{r.created_by}</td>
                <td style={{ padding: "5px 8px", borderBottom: "1px solid #f1f5f9" }}>
                  <button onClick={() => void openTpl(r)} style={{ marginRight: 6 }}>{t("report.tpl.map", locale)}</button>
                  <button onClick={() => void toggle(r)} disabled={busy} style={{ marginRight: 6 }}>
                    {r.enabled === 1 ? t("common.enabled.n", locale) : t("common.enabled.y", locale)}
                  </button>
                  <button onClick={() => void remove(r)} disabled={busy}>{t("common.delete", locale)}</button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={6} style={{ padding: "16px 8px", color: "#94a3b8", textAlign: "center" }}>
                {t("no_data", locale)}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 字段映射配置 */}
      {sel && (
        <div style={box}>
          <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 14 }}>
            {t("report.tpl.map_title", locale)}：{sel.tpl_name}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
            <select value={sheet} onChange={e => setSheet(e.target.value)} style={inp}>
              {(sel.sheets || []).map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <button onClick={() => void saveMapping()} disabled={busy}>{t("save", locale)}</button>
          </div>
          <div style={{ maxHeight: 380, overflow: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead><tr>
                {[t("report.tpl.cell", locale), t("report.tpl.cell_value", locale), t("report.tpl.field", locale)].map(h => (
                  <th key={h} style={{ padding: "5px 8px", borderBottom: "1px solid var(--border, #e2e8f0)", textAlign: "left", position: "sticky", top: 0, background: "#fff" }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {(cells?.rows || []).filter(c => !sheet || c.sheet === sheet).map(c => (
                  <tr key={`${c.sheet}-${c.cell}`}>
                    <td style={{ padding: "4px 8px", borderBottom: "1px solid #f1f5f9" }}>{c.cell}</td>
                    <td style={{ padding: "4px 8px", borderBottom: "1px solid #f1f5f9", color: "#64748b" }}>{c.value}</td>
                    <td style={{ padding: "4px 8px", borderBottom: "1px solid #f1f5f9" }}>
                      <select
                        value={mapping[c.sheet]?.[c.cell] || ""}
                        onChange={e => setCellField(c.sheet, c.cell, e.target.value)}
                        style={{ ...inp, fontSize: 12, maxWidth: 260 }}>
                        <option value="">—</option>
                        {(cells?.fields || []).map(f => (
                          <option key={f.key} value={f.key}>{f.label}（{f.key}）</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
                {(cells?.rows || []).length === 0 && (
                  <tr><td colSpan={3} style={{ padding: "14px 8px", color: "#94a3b8", textAlign: "center" }}>
                    {t("no_data", locale)}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 生成报告 */}
      <div style={box}>
        <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 14 }}>{t("report.tpl.gen_title", locale)}</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input value={poNo} onChange={e => setPoNo(e.target.value)}
            placeholder={t("report.tpl.po_ph", locale)} style={{ ...inp, width: 180 }} />
          <button onClick={() => void doCheck()} disabled={busy}>{t("report.tpl.check", locale)}</button>
          <button onClick={() => void gen()} disabled={busy || !sel}>{t("report.tpl.gen", locale)}</button>
          {!sel && <span style={{ fontSize: 12, color: "#b45309" }}>{t("report.tpl.pick_tpl", locale)}</span>}
        </div>
        {pre && (
          <div style={{ marginTop: 10 }}>
            {pre.warnings.length > 0 && (
              <div style={{ fontSize: 13, color: pre.ok ? "#b45309" : "#b91c1c", whiteSpace: "pre-wrap" }}>
                {pre.warnings.map((w, i) => <div key={i}>• {w}</div>)}
              </div>
            )}
            {pre.ok && (
              <div style={{ fontSize: 13, color: "#15803d" }}>✓ {t("report.tpl.check_ok", locale)}</div>
            )}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8, fontSize: 12, color: "#475569" }}>
              {Object.entries(pre.fields).filter(([, v]) => v !== "" && v !== null && v !== undefined).map(([k, v]) => (
                <span key={k}>{k}：<b>{String(v)}</b></span>
              ))}
            </div>
            {pre.editable.length > 0 && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                {pre.editable.map(ed => (
                  <label key={ed.key} style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
                    {ed.label}
                    <input
                      value={overrides[ed.key] ?? ""}
                      onChange={e => setOverrides(o => ({ ...o, [ed.key]: e.target.value }))}
                      style={{ ...inp, width: 160 }} />
                  </label>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
