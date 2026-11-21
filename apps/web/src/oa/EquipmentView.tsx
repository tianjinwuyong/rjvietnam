import { useCallback, useEffect, useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { apiClient } from "../api/client";
import { t } from "./i18n";

/**
 * 设备管理组 —— 设备台账 / 盘点 / 任务 / 校准 / 预警（modules.js + stocktake.js）。
 * 台账支持新增（编号+名称必填）；其余页以列表 + 关键操作为主。
 */

interface EquipRow {
  id: number | string; code: string; name: string; model?: string | null;
  location?: string | null; dept_name?: string | null; maintain_cycle?: number | null;
  external_cycle?: number | null; next_maintain_date?: string | null; next_external_date?: string | null;
  status?: string | null;
}
interface StocktakeRow { id: number | string; title?: string | null; name?: string | null; status?: string | null; created_at?: string; created_by_name?: string | null; [key: string]: unknown }
interface TaskRow { id: number | string; [key: string]: unknown }
interface CalibRow { id: number | string; equipment_id?: number | string; equipment_code?: string | null; equipment_name?: string | null; calib_date?: string | null; next_date?: string | null; result?: string | null; [key: string]: unknown }
interface AlertRow { id: number | string; [key: string]: unknown }

function fmtDate(v: unknown): string {
  if (!v) return "—";
  const s = String(v);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

const btn = { padding: "4px 10px", cursor: "pointer" } as const;

// ============ 设备台账 ============

function EquipListPage({ locale }: { locale: Locale }) {
  const [rows, setRows] = useState<EquipRow[] | null>(null);
  const [keyword, setKeyword] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [adding, setAdding] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [model, setModel] = useState("");
  const [location, setLocation] = useState("");
  const [maintainCycle, setMaintainCycle] = useState("90");
  const [externalCycle, setExternalCycle] = useState("365");

  const load = useCallback(async () => {
    setError("");
    try {
      const q: Record<string, unknown> = {};
      if (keyword.trim()) q.keyword = keyword.trim();
      setRows(await apiClient.get<EquipRow[]>("/api/equipment", q));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [keyword]);

  useEffect(() => { void load(); }, [load]);

  const add = async () => {
    setError("");
    if (!code.trim() || !name.trim()) { setMessage(t("equipExtra.codeRequired", locale)); return; }
    try {
      await apiClient.post("/api/equipment", {
        code: code.trim(), name: name.trim(), model: model.trim() || null,
        location: location.trim() || null,
        maintain_cycle: Number(maintainCycle) || 0,
        external_cycle: Number(externalCycle) || 365,
      });
      setMessage(t("common.save", locale) + " ✓");
      setAdding(false);
      setCode(""); setName(""); setModel(""); setLocation("");
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const needMaintain = (r: EquipRow): boolean => {
    if (!r.next_maintain_date) return false;
    return new Date(r.next_maintain_date).getTime() <= Date.now();
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
        <button onClick={() => setAdding(a => !a)} style={{ padding: "7px 14px", cursor: "pointer", background: "#0f766e", color: "#fff", border: 0, borderRadius: 6, fontWeight: 600 }}>
          {t("equipment.add", locale)}
        </button>
        <input value={keyword} onChange={e => setKeyword(e.target.value)} placeholder={t("equipExtra.searchPlaceholder", locale)}
          style={{ width: 220, padding: "6px 10px" }} onKeyDown={e => { if (e.key === "Enter") void load(); }} />
        <button onClick={() => void load()} style={btn}>{t("common.search", locale)}</button>
        {message && <span style={{ fontSize: 13, color: "#15803d" }}>{message}</span>}
      </div>

      {adding && (
        <div className="surface-panel" style={{ padding: "12px 14px", marginBottom: 12, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <label style={{ display: "block", fontSize: 12, marginBottom: 3 }}>{t("equipment.code", locale)} *</label>
            <input value={code} onChange={e => setCode(e.target.value)} style={{ width: 130 }} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 12, marginBottom: 3 }}>{t("equipment.name", locale)} *</label>
            <input value={name} onChange={e => setName(e.target.value)} style={{ width: 150 }} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 12, marginBottom: 3 }}>{t("equipment.model", locale)}</label>
            <input value={model} onChange={e => setModel(e.target.value)} style={{ width: 120 }} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 12, marginBottom: 3 }}>{t("equipment.location", locale)}</label>
            <input value={location} onChange={e => setLocation(e.target.value)} style={{ width: 120 }} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 12, marginBottom: 3 }}>{t("equipment.maintainCycle", locale)}</label>
            <input type="number" value={maintainCycle} onChange={e => setMaintainCycle(e.target.value)} style={{ width: 80 }} />
            <span style={{ fontSize: 12, color: "var(--text-muted, #64748b)" }}>{t("equipExtra.maintUnit", locale)}</span>
          </div>
          <div>
            <label style={{ display: "block", fontSize: 12, marginBottom: 3 }}>{t("equipment.externalCycle", locale)}</label>
            <input type="number" value={externalCycle} onChange={e => setExternalCycle(e.target.value)} style={{ width: 80 }} />
            <span style={{ fontSize: 12, color: "var(--text-muted, #64748b)" }}>{t("equipExtra.extUnit", locale)}</span>
          </div>
          <button onClick={() => void add()} style={{ ...btn, padding: "8px 16px" }}>{t("common.save", locale)}</button>
        </div>
      )}

      {error && <p style={{ color: "var(--danger, #b91c1c)", fontSize: 13 }}>{error}</p>}
      {!rows ? <div className="empty-state">{t("common.loading", locale)}</div>
        : rows.length === 0 ? <div className="empty-state">{t("common.empty", locale)}</div>
          : (
            <div className="table-shell">
              <table>
                <thead>
                  <tr>
                    <th>{t("equipment.code", locale)}</th>
                    <th>{t("equipment.name", locale)}</th>
                    <th style={{ width: 110 }}>{t("equipment.model", locale)}</th>
                    <th style={{ width: 110 }}>{t("equipment.location", locale)}</th>
                    <th style={{ width: 110 }}>{t("equipment.dept", locale)}</th>
                    <th style={{ width: 110 }}>{t("equipment.nextMaintain", locale)}</th>
                    <th style={{ width: 110 }}>{t("equipment.nextExternal", locale)}</th>
                    <th style={{ width: 90 }}>{t("announce.status", locale)}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={String(r.id)}>
                      <td>{r.code}</td>
                      <td>{r.name}</td>
                      <td>{r.model ?? "-"}</td>
                      <td>{r.location ?? "-"}</td>
                      <td>{r.dept_name ?? "-"}</td>
                      <td>{fmtDate(r.next_maintain_date)}</td>
                      <td>{fmtDate(r.next_external_date)}</td>
                      <td style={{ color: needMaintain(r) ? "#b45309" : "#15803d", fontWeight: 600 }}>
                        {needMaintain(r) ? t("equipment.needMaintain", locale) : t("equipment.normal", locale)}
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

// ============ 通用只读列表页 ============

function GenericListPage({
  locale, url, columns, onReloadKey,
}: {
  locale: Locale;
  url: string;
  columns: Array<{ key: string; label: string; width?: number; fmt?: (v: unknown, row: Record<string, unknown>) => string }>;
  onReloadKey?: string;
}) {
  const [rows, setRows] = useState<Array<Record<string, unknown>> | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const r = await apiClient.get<unknown>(url);
      setRows(Array.isArray(r) ? r as Array<Record<string, unknown>> : ((r as { list?: Array<Record<string, unknown>> }).list ?? []));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, onReloadKey]);

  useEffect(() => { void load(); }, [load]);

  if (error) return <p style={{ color: "var(--danger, #b91c1c)", fontSize: 13 }}>{error}</p>;
  if (!rows) return <div className="empty-state">{t("common.loading", locale)}</div>;
  if (rows.length === 0) return <div className="empty-state">{t("common.empty", locale)}</div>;

  return (
    <div className="table-shell">
      <table>
        <thead>
          <tr>{columns.map(c => <th key={c.key} style={c.width ? { width: c.width } : undefined}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={String(row.id ?? i)}>
              {columns.map(c => <td key={c.key}>{c.fmt ? c.fmt(row[c.key], row) : cell(row[c.key])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function cell(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  const s = String(v);
  return s.length >= 19 && /^\d{4}-\d{2}-\d{2}T/.test(s) ? s.slice(0, 16).replace("T", " ") : s;
}

// ============ 出口 ============

export type EquipSubView = "equipment" | "equipStocktake" | "equipTasks" | "equipCalib" | "equipAlerts";

export function EquipmentView({ locale, sub }: { locale: Locale; sub: EquipSubView }) {
  if (sub === "equipStocktake") {
    return (
      <GenericListPage
        locale={locale}
        url="/api/equipment/stocktakes"
        columns={[
          { key: "name", label: t("equipStocktake.name", locale), fmt: (v, row) => String(v ?? row.title ?? row.id ?? "-") },
          { key: "status", label: t("announce.status", locale) },
          { key: "created_by_name", label: t("driveExtra.operator", locale) },
          { key: "created_at", label: t("driveExtra.time", locale), fmt: v => fmtDate(v) },
        ]}
      />
    );
  }
  if (sub === "equipTasks") {
    return (
      <GenericListPage
        locale={locale}
        url="/api/equipment/tasks"
        columns={[
          { key: "id", label: "ID" },
          { key: "equipment_name", label: t("equipment.name", locale), fmt: (v, row) => String(v ?? row.equipment_code ?? "-") },
          { key: "task_type", label: t("equipment.maintainCycle", locale), fmt: v => String(v ?? "-") },
          { key: "plan_date", label: t("training.planDate", locale), fmt: v => fmtDate(v) },
          { key: "status", label: t("announce.status", locale) },
        ]}
      />
    );
  }
  if (sub === "equipCalib") {
    return (
      <GenericListPage
        locale={locale}
        url="/api/equipment/calibrations"
        columns={[
          { key: "equipment_code", label: t("equipment.code", locale), fmt: (v, row) => String(v ?? row.code ?? "-") },
          { key: "equipment_name", label: t("equipment.name", locale), fmt: (v, row) => String(v ?? row.name ?? "-") },
          { key: "calib_date", label: t("calib.actualDate", locale), fmt: v => fmtDate(v) },
          { key: "next_date", label: t("equipment.nextExternal", locale), fmt: v => fmtDate(v) },
          { key: "result", label: t("announce.status", locale) },
        ]}
      />
    );
  }
  if (sub === "equipAlerts") {
    return (
      <GenericListPage
        locale={locale}
        url="/api/equipment/alerts"
        columns={[
          { key: "equipment_code", label: t("equipment.code", locale), fmt: (v, row) => String(v ?? row.code ?? "-") },
          { key: "equipment_name", label: t("equipment.name", locale), fmt: (v, row) => String(v ?? row.name ?? "-") },
          { key: "alert_type", label: t("equipAlert.title", locale), fmt: v => String(v ?? "-") },
          { key: "days_left", label: t("equipAlert.leftDays", locale), fmt: v => String(v ?? "-") },
          { key: "sent_to", label: t("equipAlert.sentTo", locale), fmt: v => String(v ?? "-") },
          { key: "sent_at", label: t("driveExtra.time", locale), fmt: v => fmtDate(v) },
        ]}
      />
    );
  }
  return <EquipListPage locale={locale} />;
}
