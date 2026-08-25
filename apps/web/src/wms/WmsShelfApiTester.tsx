/**
 * WmsShelfApiTester — Smart Rack REST API Testing Page
 *
 * API server (port 8080) proxies shelf operations to the physical controller
 * at 10.100.29.151:8093 (unreachable from this machine — POST ops will time out).
 * All GET endpoints hit SQL Server 192.168.0.110 directly via the API server.
 *
 * Endpoints (GET — no auth required):
 *   GET /api/shelf/cells              → all 127 occupied cells from Sys_CellsInfo
 *   GET /api/shelf/cells/:shelfCode   → cells for one shelf side (L001A/B, L002A/B, L003A/B)
 *   GET /api/shelf/labels             → all labels from T_ShelfAndLabelInfo
 *   GET /api/shelf/racks              → full 2800-bin grid with occupancy
 *   GET /api/shelf/summary            → aggregate stats per shelf
 *   GET /api/wms/shelf/status         → per-shelf occupancy summary
 *
 * Endpoints (POST — proxied to physical controller at 10.100.29.151:8093):
 *   POST /api/wms/shelf/light-on      { shelfCode, color }
 *   POST /api/wms/shelf/shelf-in      { shelfCode, labelId }
 *   POST /api/wms/shelf/shelf-out     { labelIdListJson }   ← JSON stringified array
 *   POST /api/wms/shelf/remove-label  { labelId }
 */
import { useState, useCallback, useRef } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";

/* ── types ─────────────────────────────────────────────────────────── */
type Method = "GET" | "POST";
type RowStatus = "idle" | "loading" | "ok" | "ng" | "error";

interface TestRow {
  id: string;
  group: string;
  label: string;
  method: Method;
  path: string;
  description: string;
  body?: string;
  status: RowStatus;
  latencyMs?: number;
  request?: unknown;
  response?: unknown;
  error?: string;
}

/* ── endpoint definitions ─────────────────────────────────────────── */
const ENDPOINTS: Omit<TestRow, "status" | "latencyMs" | "request" | "response" | "error">[] = [
  // ── Query (read) — no auth required ─────────────────────────────
  {
    id: "cells-all",
    group: "Query",
    label: "GET /shelf/cells",
    method: "GET",
    path: "/api/shelf/cells",
    description: "All 127 occupied cells from Sys_CellsInfo (GM_WareHouse)",
  },
  {
    id: "cells-l001a",
    group: "Query",
    label: "GET /shelf/cells/L001A",
    method: "GET",
    path: "/api/shelf/cells/L001A",
    description: "Cells for rack L001A (Area 1, 34 cells)",
  },
  {
    id: "cells-l001b",
    group: "Query",
    label: "GET /shelf/cells/L001B",
    method: "GET",
    path: "/api/shelf/cells/L001B",
    description: "Cells for rack L001B (Area 2, 35 cells)",
  },
  {
    id: "cells-l002a",
    group: "Query",
    label: "GET /shelf/cells/L002A",
    method: "GET",
    path: "/api/shelf/cells/L002A",
    description: "Cells for rack L002A (Area 3, 15 cells)",
  },
  {
    id: "cells-l002b",
    group: "Query",
    label: "GET /shelf/cells/L002B",
    method: "GET",
    path: "/api/shelf/cells/L002B",
    description: "Cells for rack L002B (Area 4, 16 cells) — L002B is the only occupied side",
  },
  {
    id: "labels-all",
    group: "Query",
    label: "GET /shelf/labels",
    method: "GET",
    path: "/api/shelf/labels",
    description: "All 12 label records from T_ShelfAndLabelInfo",
  },
  {
    id: "labels-filter",
    group: "Query",
    label: "GET /shelf/labels?ShelfCode=L002A",
    method: "GET",
    path: "/api/shelf/labels?ShelfCode=L002A",
    description: "Labels filtered by shelf code",
  },
  {
    id: "summary",
    group: "Query",
    label: "GET /shelf/summary",
    method: "GET",
    path: "/api/shelf/summary",
    description: "Aggregation: cells + labels per area",
  },
  {
    id: "racks",
    group: "Query",
    label: "GET /shelf/racks",
    method: "GET",
    path: "/api/shelf/racks",
    description: "Full 2800-bin grid (T_BASE_BIN) with occupancy from Sys_CellsInfo",
  },
  {
    id: "wms-status",
    group: "Query",
    label: "GET /wms/shelf/status",
    method: "GET",
    path: "/api/wms/shelf/status",
    description: "Per-shelf stats: totalCells, occupiedCells, labelCount, layers × cols",
  },
  // ── Actions (write) — proxied to physical controller ────────────
  // Physical controller at 10.100.29.151:8093 — unreachable from this machine,
  // expect PROXY_ERROR / timeout for all POST operations.
  {
    id: "light-on",
    group: "Action",
    label: "POST /wms/shelf/light-on",
    method: "POST",
    path: "/api/wms/shelf/light-on",
    description: "Light on all empty slots · color: 1=white, 3=blue, 4=yellow, 0=off",
    body: JSON.stringify({ shelfCode: "L001A", color: 1 }, null, 2),
  },
  {
    id: "light-off",
    group: "Action",
    label: "POST /wms/shelf/light-on (off)",
    method: "POST",
    path: "/api/wms/shelf/light-on",
    description: "Light off all slots on a rack · color: 0 = off",
    body: JSON.stringify({ shelfCode: "L001A", color: 0 }, null, 2),
  },
  {
    id: "shelf-in",
    group: "Action",
    label: "POST /wms/shelf/shelf-in",
    method: "POST",
    path: "/api/wms/shelf/shelf-in",
    description: "Store a label on a rack (proxied to ShelfInGY on physical controller)",
    body: JSON.stringify({ shelfCode: "L001A", labelId: "TEST-BATCH-001" }, null, 2),
  },
  {
    id: "shelf-out",
    group: "Action",
    label: "POST /wms/shelf/shelf-out",
    method: "POST",
    path: "/api/wms/shelf/shelf-out",
    description: "Remove labels from rack (proxied to ShelfOutGY) · labelIdListJson = JSON stringified array",
    body: JSON.stringify({ labelIdListJson: '["TEST-BATCH-001"]' }, null, 2),
  },
  {
    id: "remove-label",
    group: "Action",
    label: "POST /wms/shelf/remove-label",
    method: "POST",
    path: "/api/wms/shelf/remove-label",
    description: "Remove a specific label from inventory (proxied to InventoryRemoveLableGY)",
    body: JSON.stringify({ labelId: "XHD2604030001" }, null, 2),
  },
];

/* ── helpers ──────────────────────────────────────────────────────── */
function statusColor(s: RowStatus): string {
  switch (s) {
    case "ok": return "#10b981";
    case "ng": return "#f97316";
    case "error": return "#ef4444";
    case "loading": return "#3b82f6";
    default: return "#6b7280";
  }
}

function statusLabel(s: RowStatus): string {
  switch (s) {
    case "ok": return "OK";
    case "ng": return "NG";
    case "error": return "ERR";
    case "loading": return "…";
    default: return "—";
  }
}

function msTag(ms?: number): string {
  if (ms === undefined) return "";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function jsonPretty(v: unknown): string {
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
}

function truncate(s: string, n = 120): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

/* ── single test row ──────────────────────────────────────────────── */
function TestRowComponent({
  row,
  onRun,
  baseUrl,
}: {
  row: TestRow;
  onRun: (id: string) => void;
  baseUrl: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const isLoading = row.status === "loading";

  const href = `${baseUrl}${row.path}`;
  const canRun = !isLoading;

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 8,
        overflow: "hidden",
        background: "var(--bg)",
      }}
    >
      {/* header row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          cursor: "pointer",
          background: isLoading ? "#1e3a5f" : undefined,
        }}
        onClick={() => setExpanded((x) => !x)}
      >
        {/* status badge */}
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 36,
            height: 20,
            borderRadius: 4,
            fontSize: 10,
            fontWeight: 700,
            fontFamily: "monospace",
            background: statusColor(row.status) + "22",
            color: statusColor(row.status),
            border: `1px solid ${statusColor(row.status)}44`,
            flexShrink: 0,
          }}
        >
          {statusLabel(row.status)}
        </span>

        {/* method badge */}
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "1px 6px",
            borderRadius: 3,
            fontSize: 10,
            fontWeight: 700,
            fontFamily: "monospace",
            background: row.method === "GET" ? "#065f4622" : "#7c3aed22",
            color: row.method === "GET" ? "#34d399" : "#a78bfa",
            border: `1px solid ${row.method === "GET" ? "#065f4644" : "#7c3aed44"}`,
            flexShrink: 0,
          }}
        >
          {row.method}
        </span>

        {/* path */}
        <code
          style={{
            fontSize: 12,
            color: "#f9fafb",
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {row.path}
        </code>

        {/* latency */}
        {row.latencyMs !== undefined && (
          <span style={{ fontSize: 10, color: "#9ca3af", fontFamily: "monospace", flexShrink: 0 }}>
            {msTag(row.latencyMs)}
          </span>
        )}

        {/* run button */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (canRun) onRun(row.id);
          }}
          disabled={!canRun}
          style={{
            padding: "3px 10px",
            borderRadius: 4,
            border: "none",
            fontSize: 11,
            fontWeight: 600,
            cursor: canRun ? "pointer" : "not-allowed",
            background: isLoading ? "#1e40af" : "#3b82f6",
            color: "#fff",
            flexShrink: 0,
          }}
        >
          {isLoading ? "…" : "Run"}
        </button>
      </div>

      {/* description */}
      <div
        style={{
          padding: "4px 12px 6px",
          fontSize: 11,
          color: "var(--muted)",
        }}
      >
        {row.description}
      </div>

      {/* expanded detail */}
      {expanded && (
        <div
          style={{
            borderTop: "1px solid var(--border)",
            padding: "10px 12px",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {Boolean(row.request) && (
            <div>
              <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 4, fontWeight: 600 }}>
                REQUEST → {row.method} {href}
              </div>
              <pre
                style={{
                  background: "#0f172a",
                  border: "1px solid #1e293b",
                  borderRadius: 6,
                  padding: "8px 10px",
                  fontSize: 11,
                  color: "#94a3b8",
                  overflow: "auto",
                  maxHeight: 160,
                  margin: 0,
                  fontFamily: "monospace",
                }}
              >
                {jsonPretty(row.request as object)}
              </pre>
            </div>
          )}

          {/* response */}
          {Boolean(row.response) !== false && (
            <div>
              <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 4, fontWeight: 600 }}>
                RESPONSE {row.latencyMs !== undefined ? `· ${msTag(row.latencyMs)}` : ""}
              </div>
              <pre
                style={{
                  background: "#0f172a",
                  border: `1px solid ${statusColor(row.status)}44`,
                  borderRadius: 6,
                  padding: "8px 10px",
                  fontSize: 11,
                  color: statusColor(row.status),
                  overflow: "auto",
                  maxHeight: 240,
                  margin: 0,
                  fontFamily: "monospace",
                }}
              >
                {truncate(jsonPretty(row.response as object), 2000)}
              </pre>
            </div>
          )}

          {/* error */}
          {row.error && (
            <div>
              <div style={{ fontSize: 10, color: "#ef4444", marginBottom: 4, fontWeight: 600 }}>ERROR</div>
              <pre
                style={{
                  background: "#1f0f0f",
                  border: "1px solid #ef444444",
                  borderRadius: 6,
                  padding: "8px 10px",
                  fontSize: 11,
                  color: "#fca5a5",
                  overflow: "auto",
                  maxHeight: 120,
                  margin: 0,
                  fontFamily: "monospace",
                }}
              >
                {row.error}
              </pre>
            </div>
          )}

          {!row.request && !row.response && !row.error && (
            <div style={{ fontSize: 11, color: "var(--muted)", fontStyle: "italic" }}>
              No data yet — click Run to execute
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── main component ──────────────────────────────────────────────── */
export function WmsShelfApiTester({ locale }: { locale: Locale }) {
  const [baseUrl, setBaseUrl] = useState(() => {
    // Default: use the Vite dev server origin so requests go through the proxy.
    // Fallback to localhost:8080 (direct to API server) if Vite proxy is not available.
    if (typeof window !== "undefined") {
      const proto = window.location.protocol === "https:" ? "https:" : "http:";
      // Try current origin (Vite dev server on 5178) first, then fallback
      const current = `${proto}//${window.location.hostname}:${window.location.port}`;
      return current;
    }
    return "http://localhost:8080";
  });
  const [rows, setRows] = useState<TestRow[]>(
    ENDPOINTS.map((e) => ({ ...e, status: "idle" as RowStatus }))
  );
  const abortRefs = useRef<Map<string, AbortController>>(new Map());

  const runOne = useCallback(
    async (id: string) => {
      const row = rows.find((r) => r.id === id);
      if (!row) return;

      // Cancel any in-flight request for this row
      abortRefs.current.get(id)?.abort();
      const ac = new AbortController();
      abortRefs.current.set(id, ac);

      // Parse body for POST
      let body: string | undefined;
      if (row.method === "POST" && row.body) {
        body = row.body;
      }

      setRows((prev) =>
        prev.map((r) =>
          r.id === id ? { ...r, status: "loading" as RowStatus, latencyMs: undefined, response: undefined, error: undefined } : r
        )
      );

      const t0 = Date.now();
      try {
        const res = await fetch(`${baseUrl}${row.path}`, {
          method: row.method,
          headers: { "Content-Type": "application/json" },
          body,
          signal: ac.signal,
        });
        const latencyMs = Date.now() - t0;
        let response: unknown;
        try {
          response = await res.json();
        } catch {
          response = await res.text();
        }
        const ok = res.ok;
        setRows((prev) =>
          prev.map((r) =>
            r.id === id
              ? { ...r, status: ok ? "ok" : "ng" as RowStatus, latencyMs, response, request: body ? JSON.parse(body) : undefined }
              : r
          )
        );
      } catch (e: unknown) {
        const latencyMs = Date.now() - t0;
        const error = e instanceof Error ? e.message : String(e);
        setRows((prev) =>
          prev.map((r) =>
            r.id === id
              ? { ...r, status: "error" as RowStatus, latencyMs, error, request: body ? JSON.parse(body!) : undefined }
              : r
          )
        );
      }
    },
    [rows, baseUrl]
  );

  const runAll = useCallback(async () => {
    for (const row of rows) {
      await runOne(row.id);
      // small delay between requests
      await new Promise((r) => setTimeout(r, 100));
    }
  }, [rows, runOne]);

  // Group rows
  const groups = Array.from(new Set(rows.map((r) => r.group)));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* page header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
            {t("shelfApi.title", locale)}
          </h2>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--muted)" }}>
            {t("shelfApi.subtitle", locale)}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label style={{ fontSize: 11, color: "var(--muted)" }}>
            API Base:
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="http://localhost:5178"
              style={{
                marginLeft: 6,
                padding: "4px 8px",
                borderRadius: 4,
                border: "1px solid var(--border)",
                background: "var(--bg)",
                color: "#f9fafb",
                fontSize: 12,
                fontFamily: "monospace",
                width: 240,
              }}
            />
          </label>
          <button
            type="button"
            onClick={runAll}
            style={{
              padding: "6px 16px",
              borderRadius: 6,
              border: "none",
              background: "#3b82f6",
              color: "#fff",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            ▶ {t("shelfApi.runAll", locale)}
          </button>
        </div>
      </div>

      {/* summary stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
        {(["ok", "ng", "error", "idle"] as RowStatus[]).map((s) => (
          <div
            key={s}
            style={{
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "10px 14px",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 22, fontWeight: 800, color: statusColor(s) }}>
              {rows.filter((r) => r.status === s).length}
            </div>
            <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>
              {s === "ok" ? "Pass" : s === "ng" ? "NG" : s === "error" ? "Error" : "Idle"}{" "}
              ({rows.filter((r) => r.status === s).length}/{rows.length})
            </div>
          </div>
        ))}
      </div>

      {/* endpoints by group */}
      {groups.map((group) => (
        <div key={group} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "var(--muted)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              paddingBottom: 4,
              borderBottom: "1px solid var(--border)",
            }}
          >
            {group} — {rows.filter((r) => r.group === group).length} endpoints
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {rows
              .filter((r) => r.group === group)
              .map((row) => (
                <TestRowComponent key={row.id} row={row} onRun={runOne} baseUrl={baseUrl} />
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}