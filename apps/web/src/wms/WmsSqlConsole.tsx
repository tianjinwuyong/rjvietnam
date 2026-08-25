/**
 * WmsSqlConsole — web-based SQL Server query tool
 *
 * Connects to GM_WareHouse SQL Server via our API server.
 * Server options:
 *   • http://localhost:8080  — direct to API server (default, dev machine)
 *   • http://192.168.0.110:8080 — same machine via network IP (factory floor)
 *
 * Endpoints used (no JWT required — /sql/* is in the auth skip list):
 *   GET  /api/sql/tables  → list all tables
 *   POST /api/sql         → execute raw SQL (SELECT only recommended)
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";

/* ── server options ───────────────────────────────────────────────── */
const SERVERS = [
  { label: "localhost:8080", value: "http://localhost:8080" },
  { label: "192.168.0.110:8080", value: "http://192.168.0.110:8080" },
];

const API_TIMEOUT = 30000;

interface TableInfo {
  TABLE_NAME: string;
  TABLE_TYPE: string;
}

interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  duration: number;
  type?: string;
  message?: string;
}

interface HistoryEntry {
  sql: string;
  result: QueryResult | { error: string };
  time: string;
}

const PRESET_QUERIES = [
  { label: "所有表", sql: "SELECT TABLE_NAME, TABLE_TYPE FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_CATALOG = 'GM_WareHouse' ORDER BY TABLE_TYPE, TABLE_NAME" },
  { label: "T_ShelfAndLabelInfo", sql: "SELECT TOP 20 * FROM T_ShelfAndLabelInfo ORDER BY CreateTime DESC" },
  { label: "Sys_CellsInfo", sql: "SELECT TOP 20 * FROM Sys_CellsInfo ORDER BY Area, Layer, Colu" },
  { label: "Inventory_Listinfo", sql: "SELECT TOP 20 * FROM Inventory_Listinfo ORDER BY InputTime DESC" },
  { label: "T_BASE_BIN (L001)", sql: "SELECT TOP 20 * FROM T_BASE_BIN WHERE F_BinCode LIKE 'L001A%' ORDER BY F_BinCode" },
  { label: "T_BASE_AREA", sql: "SELECT * FROM T_BASE_AREA ORDER BY F_AreaCode" },
  { label: "T_BASE_WAREHOUSE", sql: "SELECT * FROM T_BASE_WAREHOUSE" },
  { label: "Sys_CellsInfo count", sql: "SELECT Area, COUNT(*) as cnt FROM Sys_CellsInfo GROUP BY Area ORDER BY Area" },
  { label: "T_BASE_BIN count", sql: "SELECT a.F_AreaCode, COUNT(b.F_BinId) as bin_count FROM T_BASE_BIN b JOIN T_BASE_AREA a ON b.F_AreaId = a.F_AreaId GROUP BY a.F_AreaCode ORDER BY a.F_AreaCode" },
];

async function apiFetch(server: string, path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${server}${path}`, {
    ...init,
    signal: AbortSignal.timeout(API_TIMEOUT),
  });
  const json = await res.json();
  if (!res.ok && (json as Record<string, unknown>).error) {
    const err = (json as { error: { message: string } }).error;
    throw new Error(err.message);
  }
  return json;
}

export function WmsSqlConsole() {
  const [server, setServer] = useState(SERVERS[0].value);
  const [sql, setSql] = useState(PRESET_QUERIES[1].sql);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [tableList, setTableList] = useState<TableInfo[]>([]);
  const [tablesLoading, setTablesLoading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load table list whenever server changes
  const loadTables = useCallback(async (srv: string) => {
    setTablesLoading(true);
    setTableList([]);
    try {
      const json = await apiFetch(srv, "/api/sql/tables") as { data: { tables: TableInfo[] } };
      setTableList(json.data?.tables ?? []);
    } catch (e) {
      setError(`加载表列表失败: ${e instanceof Error ? e.message : e}`);
    } finally {
      setTablesLoading(false);
    }
  }, []);

  useEffect(() => { loadTables(server); }, [server, loadTables]);

  const run = useCallback(async (sqlToRun?: string) => {
    const q = sqlToRun ?? sql;
    if (!q.trim()) return;
    setRunning(true);
    setError(null);
    setResult(null);
    const start = Date.now();
    try {
      const json = await apiFetch(server, "/api/sql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql: q }),
      }) as QueryResult;

      // Normalize POST /api/sql response (no envelope) vs GET (with envelope)
      const data = (json as unknown as Record<string, unknown>).data as QueryResult | undefined;
      setResult(data ?? (json as QueryResult));
      setHistory((prev) => [
        {
          sql: q,
          result: data ?? (json as QueryResult),
          time: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
        },
        ...prev,
      ].slice(0, 50));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setHistory((prev) => [
        { sql: q, result: { error: msg }, time: new Date().toLocaleTimeString("zh-CN", { hour12: false }) },
        ...prev,
      ].slice(0, 50));
    } finally {
      setRunning(false);
    }
  }, [sql, server]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      run();
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const ta = textareaRef.current!;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const newVal = sql.substring(0, start) + "  " + sql.substring(end);
      setSql(newVal);
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 2;
      });
    }
  };

  const insertTable = (tableName: string) => {
    const newSql = `SELECT TOP 20 * FROM ${tableName}`;
    setSql(newSql);
    textareaRef.current?.focus();
  };

  const currentServerLabel = SERVERS.find(s => s.value === server)?.label ?? server;

  return (
    <div className="screen-stack">
      {/* Header */}
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("sqlConsole.title", "zh-CN")}</h2>
            <p>{t("sqlConsole.subtitle", "zh-CN")}</p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {/* Server selector */}
            <select
              value={server}
              onChange={(e) => setServer(e.target.value)}
              style={{
                padding: "5px 8px",
                borderRadius: 4,
                border: "1px solid var(--border)",
                background: "var(--bg)",
                color: "#f9fafb",
                fontSize: 12,
                fontFamily: "monospace",
                cursor: "pointer",
              }}
            >
              {SERVERS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
            <span style={{ fontSize: 11, color: "var(--muted)" }}>
              {currentServerLabel}
            </span>
            <button
              type="button"
              className="action-button"
              onClick={() => run()}
              disabled={running}
              style={{ minWidth: 80 }}
            >
              {running ? "⏳…" : "▶ 执行"}
            </button>
          </div>
        </div>
      </section>

      {/* Main: sidebar + editor + results */}
      <div className="content-grid two" style={{ gridTemplateColumns: "220px 1fr", gap: 12, alignItems: "start" }}>

        {/* Left: table list + presets */}
        <aside className="surface-panel" style={{ padding: "12px 0" }}>
          <div style={{ padding: "0 12px 6px", fontSize: 11, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            📋 预设查询
          </div>
          {PRESET_QUERIES.map((pq, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setSql(pq.sql)}
              style={{
                width: "100%",
                padding: "6px 12px",
                background: "transparent",
                border: "none",
                borderLeft: sql === pq.sql ? "2px solid #3b82f6" : "2px solid transparent",
                color: sql === pq.sql ? "#93c5fd" : "var(--text)",
                fontSize: 12,
                textAlign: "left",
                cursor: "pointer",
              }}
            >
              {pq.label}
            </button>
          ))}

          <div style={{ padding: "12px 12px 6px", fontSize: 11, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", borderTop: "1px solid var(--border)", marginTop: 8 }}>
            🗄️ 表 ({tablesLoading ? "…" : tableList.length})
          </div>
          <div style={{ maxHeight: 340, overflowY: "auto" }}>
            {tablesLoading && (
              <div style={{ padding: "8px 12px", fontSize: 11, color: "var(--muted)" }}>
                加载中…
              </div>
            )}
            {!tablesLoading && tableList.map((tbl) => (
              <button
                key={tbl.TABLE_NAME}
                type="button"
                onClick={() => insertTable(tbl.TABLE_NAME)}
                title={tbl.TABLE_NAME}
                style={{
                  width: "100%",
                  padding: "5px 12px",
                  background: "transparent",
                  border: "none",
                  borderLeft: "2px solid transparent",
                  color: tbl.TABLE_TYPE === "VIEW" ? "#a78bfa" : "var(--text)",
                  fontSize: 11,
                  textAlign: "left",
                  cursor: "pointer",
                  fontFamily: "monospace",
                }}
              >
                {tbl.TABLE_NAME}
                {tbl.TABLE_TYPE === "VIEW" && (
                  <span style={{ marginLeft: 4, fontSize: 9, color: "#a78bfa" }}>V</span>
                )}
              </button>
            ))}
          </div>
        </aside>

        {/* Right: editor + results */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* SQL editor */}
          <div className="surface-panel" style={{ padding: 0 }}>
            <div style={{
              padding: "6px 12px",
              borderBottom: "1px solid var(--border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              fontSize: 11,
              color: "var(--muted)",
            }}>
              <span>SQL — GM_WareHouse @ 192.168.0.110</span>
              <span>Ctrl+Enter 执行</span>
            </div>
            <textarea
              ref={textareaRef}
              value={sql}
              onChange={(e) => setSql(e.target.value)}
              onKeyDown={handleKeyDown}
              spellCheck={false}
              style={{
                width: "100%",
                minHeight: 120,
                padding: "12px",
                background: "#0f172a",
                color: "#e2e8f0",
                border: "none",
                borderRadius: 0,
                fontFamily: "'Fira Code', 'Cascadia Code', monospace",
                fontSize: 13,
                lineHeight: 1.6,
                resize: "vertical",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>

          {/* Error */}
          {error && (
            <div style={{
              padding: "10px 14px",
              background: "#450a0a",
              border: "1px solid #ef4444",
              borderRadius: 8,
              color: "#fca5a5",
              fontSize: 12,
              fontFamily: "monospace",
            }}>
              ❌ {error}
            </div>
          )}

          {/* Results */}
          {result && !error && (
            <div className="surface-panel" style={{ padding: 0 }}>
              <div style={{
                padding: "6px 12px",
                borderBottom: "1px solid var(--border)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                fontSize: 11,
                color: "var(--muted)",
              }}>
                <span>
                  {result.type === "SELECT"
                    ? `✅ SELECT — ${result.rowCount} 行 (${result.duration}ms)`
                    : `✅ ${result.type} — ${result.message ?? result.rowCount + " 行"} (${result.duration}ms)`}
                </span>
              </div>

              {result.rows.length > 0 && (
                <div style={{ overflowX: "auto", maxHeight: 420, overflowY: "auto" }}>
                  <table style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontSize: 12,
                    fontFamily: "monospace",
                  }}>
                    <thead>
                      <tr>
                        <th style={{
                          padding: "6px 10px",
                          background: "#1e293b",
                          color: "#94a3b8",
                          textAlign: "left",
                          fontWeight: 600,
                          position: "sticky",
                          top: 0,
                          borderBottom: "1px solid var(--border)",
                          whiteSpace: "nowrap",
                        }}>
                          #
                        </th>
                        {result.columns.map((col) => (
                          <th key={col} style={{
                            padding: "6px 10px",
                            background: "#1e293b",
                            color: "#94a3b8",
                            textAlign: "left",
                            fontWeight: 600,
                            position: "sticky",
                            top: 0,
                            borderBottom: "1px solid var(--border)",
                            whiteSpace: "nowrap",
                            maxWidth: 200,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}>
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.rows.slice(0, 200).map((row, ri) => (
                        <tr key={ri} style={{ background: ri % 2 === 0 ? "transparent" : "#0f172a" }}>
                          <td style={{
                            padding: "4px 10px",
                            color: "var(--muted)",
                            borderBottom: "1px solid var(--border)",
                            fontSize: 11,
                          }}>
                            {ri + 1}
                          </td>
                          {result.columns.map((col) => {
                            const val = row[col];
                            const str = val == null ? "" : String(val);
                            const isNull = val === null || val === undefined;
                            return (
                              <td
                                key={col}
                                style={{
                                  padding: "4px 10px",
                                  color: isNull ? "#475569" : "#e2e8f0",
                                  borderBottom: "1px solid var(--border)",
                                  maxWidth: 200,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                                title={str}
                              >
                                {isNull ? <em style={{ color: "#334155" }}>NULL</em> : str}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {result.rows.length > 200 && (
                    <div style={{ padding: "8px 12px", color: "var(--muted)", fontSize: 11, textAlign: "center" }}>
                      仅显示前 200 行（共 {result.rowCount} 行）
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* History */}
          {history.length > 0 && (
            <div className="surface-panel">
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8, fontWeight: 600 }}>
                历史 ({history.length})
              </div>
              <div style={{ maxHeight: 160, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
                {history.map((h, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setSql(h.sql)}
                    title={h.sql}
                    style={{
                      width: "100%",
                      padding: "4px 8px",
                      background: "var(--bg)",
                      border: "1px solid var(--border)",
                      borderRadius: 4,
                      color: "var(--text)",
                      fontSize: 11,
                      fontFamily: "monospace",
                      textAlign: "left",
                      cursor: "pointer",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    <span style={{ color: "var(--muted)", marginRight: 6 }}>{h.time}</span>
                    {h.sql.replace(/\s+/g, " ").slice(0, 80)}
                    {"…"}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}