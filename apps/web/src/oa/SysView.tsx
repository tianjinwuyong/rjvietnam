import { useCallback, useEffect, useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { apiClient } from "../api/client";
import { t } from "./i18n";

/**
 * 系统管理组 —— 台账（流程台账）/ 流程版本 / 自定义字段。
 * 流程设计、系统设置（adminOnly）暂留建设中。
 * 台账与 doc-ledger 同构：后端返回 {columns, rows}（中越双语表头），前端按语言渲染。
 */

interface LedgerCol { key: string; label: string; label_vi?: string | null }
interface LedgerResult { columns: LedgerCol[]; rows: Array<Record<string, unknown>>; total?: number }
interface FlowRow { id: number | string; code: string; name: string; name_vi?: string | null; category?: string | null }
interface FlowVerRow { id: number | string; version?: number | string; name?: string | null; status?: string | null; creator_name?: string | null; created_at?: string; released_at?: string | null }
interface FieldRow {
  id: number | string; field_key?: string | null; label_zh?: string | null; label_vi?: string | null;
  field_type?: string | null; required?: boolean | null; sort_order?: number | null; active?: boolean | null;
  kind?: string | null; scope?: string | null;
}

function fmtDate(v: string | null | undefined): string {
  if (!v) return "—";
  return String(v).slice(0, 10);
}

function cellText(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  const s = String(v);
  return s.length >= 19 && /^\d{4}-\d{2}-\d{2}T/.test(s) ? s.slice(0, 10) : s;
}

const btn = { padding: "6px 12px", cursor: "pointer" } as const;

// ============ 流程台账 ============

function LedgerPage({ locale }: { locale: Locale }) {
  const [flows, setFlows] = useState<FlowRow[] | null>(null);
  const [code, setCode] = useState("");
  const [data, setData] = useState<LedgerResult | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [keyword, setKeyword] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    apiClient.get<FlowRow[]>("/api/flows").then(l => setFlows(l || [])).catch(() => setFlows([]));
  }, []);

  const load = useCallback(async () => {
    if (!code) { setMessage(t("ledger.noFlow", locale)); return; }
    setError("");
    try {
      const q: Record<string, unknown> = {};
      if (from) q.from = from;
      if (to) q.to = to;
      if (keyword.trim()) q.keyword = keyword.trim();
      setData(await apiClient.get<LedgerResult>(`/api/ledger/${code}`, q));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, from, to, keyword]);

  const exportCsv = () => {
    if (!data || !data.rows?.length) { setMessage(t("ledger.noData", locale)); return; }
    const header = data.columns.map(c => (locale === "vi-VN" && c.label_vi ? c.label_vi : c.label));
    const lines = [header.join(",")];
    for (const row of data.rows) {
      lines.push(data.columns.map(c => {
        const v = cellText(row[c.key]);
        return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
      }).join(","));
    }
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `ledger-${code}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    setMessage(t("ledger.exported", locale, { n: data.rows.length }));
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
        <select value={code} onChange={e => setCode(e.target.value)} style={{ padding: "6px 8px", minWidth: 200 }}>
          <option value="">{t("ledger.selectFlow", locale)}</option>
          {(flows || []).map(f => (
            <option key={String(f.id)} value={f.code}>{locale === "vi-VN" && f.name_vi ? f.name_vi : f.name}</option>
          ))}
        </select>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} title={t("ledger.from", locale)} style={{ padding: "5px 8px" }} />
        <input type="date" value={to} onChange={e => setTo(e.target.value)} title={t("ledger.to", locale)} style={{ padding: "5px 8px" }} />
        <input value={keyword} onChange={e => setKeyword(e.target.value)} placeholder={t("ledger.keyword", locale)}
          style={{ width: 160, padding: "6px 10px" }} onKeyDown={e => { if (e.key === "Enter") void load(); }} />
        <button onClick={() => void load()} style={btn}>{t("common.search", locale)}</button>
        <button onClick={exportCsv} style={btn}>{t("ledger.export", locale)}</button>
        {message && <span style={{ fontSize: 13, color: "#15803d" }}>{message}</span>}
      </div>
      {error && <p style={{ color: "var(--danger, #b91c1c)", fontSize: 13 }}>{error}</p>}
      {!code ? <div className="empty-state">{t("ledger.selectFlowHint", locale)}</div>
        : !data ? <div className="empty-state">{t("common.loading", locale)}</div>
          : !data.rows?.length ? <div className="empty-state">{t("ledger.noData", locale)}</div>
            : (
              <>
                <div style={{ fontSize: 13, color: "var(--text-muted, #64748b)", marginBottom: 6 }}>
                  {t("ledger.totalCount", locale, { n: data.total ?? data.rows.length })}
                </div>
                <div className="table-shell">
                  <table>
                    <thead>
                      <tr>{data.columns.map(c => <th key={c.key}>{locale === "vi-VN" && c.label_vi ? c.label_vi : c.label}</th>)}</tr>
                    </thead>
                    <tbody>
                      {data.rows.map((row, i) => (
                        <tr key={i}>{data.columns.map(c => <td key={c.key}>{cellText(row[c.key])}</td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
    </div>
  );
}

// ============ 流程版本 ============

function FlowVersionsPage({ locale }: { locale: Locale }) {
  const [flows, setFlows] = useState<FlowRow[] | null>(null);
  const [code, setCode] = useState("");
  const [rows, setRows] = useState<FlowVerRow[] | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    apiClient.get<FlowRow[]>("/api/flows").then(l => setFlows(l || [])).catch(() => setFlows([]));
  }, []);

  const load = useCallback(async (c: string) => {
    if (!c) { setRows(null); return; }
    setError("");
    try {
      setRows(await apiClient.get<FlowVerRow[]>(`/api/flows/${c}/versions`));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const act = async (vid: number | string, action: "release" | "rollback") => {
    const v = rows?.find(r => String(r.id) === String(vid));
    const ver = v?.version ?? "";
    const confirmMsg = action === "release"
      ? t("flowVer.releaseConfirm", locale, { ver })
      : t("flowVer.rollbackConfirm", locale, { ver });
    if (!window.confirm(confirmMsg)) return;
    try {
      await apiClient.post(`/api/flows/${code}/versions/${vid}/${action}`, {});
      setMessage(action === "release" ? t("flowVer.releasedOk", locale) : t("flowVer.rolledBack", locale));
      void load(code);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const stText = (s: string | null | undefined): string => {
    const map: Record<string, string> = { draft: "flowVer.stDraft", testing: "flowVer.stTesting", released: "flowVer.stReleased", archived: "flowVer.stArchived" };
    const key = map[s || ""];
    return key ? t(key, locale) : (s ?? "-");
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
        <select value={code} onChange={e => { setCode(e.target.value); void load(e.target.value); }} style={{ padding: "6px 8px", minWidth: 200 }}>
          <option value="">{t("ledger.selectFlow", locale)}</option>
          {(flows || []).map(f => (
            <option key={String(f.id)} value={f.code}>{locale === "vi-VN" && f.name_vi ? f.name_vi : f.name}</option>
          ))}
        </select>
        {message && <span style={{ fontSize: 13, color: "#15803d" }}>{message}</span>}
      </div>
      {error && <p style={{ color: "var(--danger, #b91c1c)", fontSize: 13 }}>{error}</p>}
      <p style={{ fontSize: 13, color: "var(--text-muted, #64748b)", margin: "0 0 8px" }}>{t("flowVer.inflightBody", locale)}</p>
      {!code ? <div className="empty-state">{t("ledger.selectFlowHint", locale)}</div>
        : !rows ? <div className="empty-state">{t("common.loading", locale)}</div>
          : rows.length === 0 ? <div className="empty-state">{t("flowVer.noVersions", locale)}</div>
            : (
              <div className="table-shell">
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: 80 }}>{t("flowVer.ver", locale)}</th>
                      <th>{t("flowVer.name", locale)}</th>
                      <th style={{ width: 90 }}>{t("flowVer.status", locale)}</th>
                      <th style={{ width: 110 }}>{t("flowVer.creator", locale)}</th>
                      <th style={{ width: 110 }}>{t("flowVer.createdAt", locale)}</th>
                      <th style={{ width: 110 }}>{t("flowVer.releasedAt", locale)}</th>
                      <th style={{ width: 150 }}>{""}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(v => (
                      <tr key={String(v.id)}>
                        <td>{v.version ?? "-"}</td>
                        <td>{v.name ?? "-"}</td>
                        <td style={{ fontWeight: v.status === "released" ? 700 : 400 }}>{stText(v.status)}</td>
                        <td>{v.creator_name ?? "-"}</td>
                        <td>{fmtDate(v.created_at)}</td>
                        <td>{fmtDate(v.released_at)}</td>
                        <td>
                          {v.status !== "released" && (
                            <>
                              <button onClick={() => void act(v.id, "release")} style={{ ...btn, marginRight: 4 }}>{t("flowVer.release", locale)}</button>
                              <button onClick={() => void act(v.id, "rollback")} style={btn}>{t("flowVer.rollback", locale)}</button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
    </div>
  );
}

// ============ 自定义字段 ============

const SCOPES = [
  { value: "inspect", key: "customField.scopeInspect" },
  { value: "ipqc", key: "customField.scopeIpcq" },
  { value: "fai", key: "customField.scopeFai" },
];

function CustomFieldsPage({ locale }: { locale: Locale }) {
  const [scope, setScope] = useState("inspect");
  const [rows, setRows] = useState<FieldRow[] | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async (s: string) => {
    setError("");
    try {
      setRows(await apiClient.get<FieldRow[]>("/api/template-fields", { scope: s }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { void load(scope); }, [scope, load]);

  const toggleActive = async (f: FieldRow) => {
    try {
      await apiClient.put(`/api/template-fields/${f.id}`, { active: !f.active });
      void load(scope);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const removeField = async (f: FieldRow) => {
    if (!window.confirm(t("customField.deleteConfirm", locale, { name: f.label_zh ?? f.field_key ?? "" }))) return;
    try {
      await apiClient.delete(`/api/template-fields/${f.id}`);
      setMessage(t("customField.deleteOk", locale));
      void load(scope);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const typeText = (ty: string | null | undefined): string => {
    const map: Record<string, string> = { text: "customField.typeText", number: "customField.typeNumber", date: "customField.typeDate", select: "customField.typeSelect" };
    const key = map[ty || ""];
    return key ? t(key, locale) : (ty ?? "-");
  };

  return (
    <div>
      <p style={{ fontSize: 13, color: "var(--text-muted, #64748b)", margin: "0 0 10px" }}>{t("customField.hint", locale)}</p>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
        <select value={scope} onChange={e => setScope(e.target.value)} style={{ padding: "6px 8px" }}>
          {SCOPES.map(s => <option key={s.value} value={s.value}>{t(s.key, locale)}</option>)}
        </select>
        {message && <span style={{ fontSize: 13, color: "#15803d" }}>{message}</span>}
      </div>
      {error && <p style={{ color: "var(--danger, #b91c1c)", fontSize: 13 }}>{error}</p>}
      {!rows ? <div className="empty-state">{t("common.loading", locale)}</div>
        : rows.length === 0 ? <div className="empty-state">{t("customField.empty", locale)}</div>
          : (
            <div className="table-shell">
              <table>
                <thead>
                  <tr>
                    <th>{t("customField.fieldKey", locale)}</th>
                    <th>{t("customField.labelZh", locale)}</th>
                    <th>{t("customField.labelVi", locale)}</th>
                    <th style={{ width: 90 }}>{t("customField.fieldType", locale)}</th>
                    <th style={{ width: 70 }}>{t("customField.required", locale)}</th>
                    <th style={{ width: 70 }}>{t("customField.active", locale)}</th>
                    <th style={{ width: 90 }}>{t("customField.kind", locale)}</th>
                    <th style={{ width: 150 }}>{""}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(f => (
                    <tr key={String(f.id)}>
                      <td>{f.field_key ?? "-"}</td>
                      <td>{f.label_zh ?? "-"}</td>
                      <td>{f.label_vi ?? "-"}</td>
                      <td>{typeText(f.field_type)}</td>
                      <td>{f.required ? "✓" : "—"}</td>
                      <td>{f.active ? "✓" : "—"}</td>
                      <td>{f.kind === "builtin" ? t("customField.kindBuiltin", locale) : t("customField.kindCustom", locale)}</td>
                      <td>
                        <button onClick={() => void toggleActive(f)} style={{ ...btn, marginRight: 4 }} title={t("customField.active", locale)}>{f.active ? "●" : "○"}</button>
                        {f.kind !== "builtin" && (
                          <button onClick={() => void removeField(f)} style={btn}>✕</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      <p style={{ fontSize: 12, color: "var(--text-muted, #64748b)" }}>{t("customField.builtinHint", locale)}</p>
    </div>
  );
}

// ============ 出口 ============

export type SysSubView = "ledger" | "flowVersions" | "customField";

export function SysView({ locale, sub }: { locale: Locale; sub: SysSubView }) {
  if (sub === "flowVersions") return <FlowVersionsPage locale={locale} />;
  if (sub === "customField") return <CustomFieldsPage locale={locale} />;
  return <LedgerPage locale={locale} />;
}
