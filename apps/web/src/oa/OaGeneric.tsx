import { useCallback, useEffect, useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { apiClient } from "../api/client";
import { t } from "./i18n";

/** 各列表页共用：日期/单元格格式化 + 通用只读表格（后端返回数组或 {list}） */

export function fmtDate(v: unknown): string {
  if (!v) return "—";
  const s = String(v);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

export function fmtTime(v: unknown): string {
  if (!v) return "—";
  const s = String(v);
  return s.length >= 16 ? s.slice(0, 16).replace("T", " ") : s;
}

export function cell(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  const s = String(v);
  return s.length >= 19 && /^\d{4}-\d{2}-\d{2}T/.test(s) ? fmtTime(s) : s;
}

export interface GenCol {
  key: string;
  label: string;
  width?: number;
  fmt?: (v: unknown, row: Record<string, unknown>) => string;
}

export function GenericListPage({
  locale, url, columns, params,
}: {
  locale: Locale;
  url: string;
  columns: GenCol[];
  params?: Record<string, unknown>;
}) {
  const [rows, setRows] = useState<Array<Record<string, unknown>> | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const r = await apiClient.get<unknown>(url, params);
      setRows(Array.isArray(r)
        ? r as Array<Record<string, unknown>>
        : ((r as { list?: Array<Record<string, unknown>> }).list ?? []));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, JSON.stringify(params || {})]);

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
