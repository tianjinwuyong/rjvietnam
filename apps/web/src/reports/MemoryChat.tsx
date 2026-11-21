import { useCallback, useState } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";

const MEMORY_SERVER = "http://127.0.0.1:9876";

interface Mem0Result {
  id?: string;
  memory?: string;
  text?: string;
  score?: number;
  agent_id?: string;
  created_at?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

interface SearchResponse {
  results?: Mem0Result[];
  error?: string;
}

const QUICK_QUESTIONS: { key: string; zh: string; agentId?: string }[] = [
  { key: "material_shortage", zh: "最近物料短缺记录" },
  { key: "supplier_delay", zh: "供应商交货延迟" },
  { key: "equipment_downtime", zh: "设备停机事件" },
  { key: "quality_defect", zh: "质量缺陷趋势" },
  { key: "wo_delay", zh: "工单延误情况" },
  { key: "inventory_diff", zh: "库存盘点差异" },
  { key: "attendance_anomaly", zh: "人员出勤异常" },
  { key: "finance_aging", zh: "应收应付超期" },
];

function fmtScore(s: number): string {
  return (s * 100).toFixed(1) + "%";
}

function agentLabel(agentId: string): string {
  const labels: Record<string, string> = {
    "wms-manager": "WMS",
    "hr-manager": "HR",
    "bom-manager": "BOM",
    "pmc-manager": "PMC",
    "procurement-manager": "采购",
    "finance-manager": "财务",
    "plant-manager": "工厂",
    "mes-manager": "MES",
  };
  return labels[agentId] ?? agentId;
}

function agentColor(agentId: string): string {
  const colors: Record<string, string> = {
    "wms-manager": "ok",
    "hr-manager": "info",
    "bom-manager": "warning",
    "pmc-manager": "danger",
    "procurement-manager": "muted",
    "finance-manager": "ok",
    "plant-manager": "info",
    "mes-manager": "warning",
  };
  return colors[agentId] ?? "info";
}

export function MemoryChat({ locale }: { locale: Locale }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Mem0Result[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) return;
    setLoading(true);
    setError(null);
    setResults(null);
    try {
      const res = await fetch(`${MEMORY_SERVER}/search_all`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q.trim(), top_k: 20 }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text}`);
      }
      const data: SearchResponse = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        const items = Array.isArray(data.results) ? data.results : [];
        setResults(items);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const handleQuickQuestion = (q: string) => {
    setQuery(q);
    doSearch(q);
  };

  return (
    <div className="screen-stack">
      {/* Search bar */}
      <div
        style={{
          display: "flex", gap: 8, marginBottom: 16,
          padding: 16, background: "var(--surface)", borderRadius: 8,
          border: "1px solid var(--border)", flexWrap: "wrap",
        }}
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") doSearch(query); }}
          placeholder={t("memory.placeholder", locale)}
          style={{
            flex: 1, minWidth: 240, padding: "8px 12px", fontSize: 14,
            border: "1px solid var(--border)", borderRadius: 4,
            background: "var(--bg)", color: "var(--text)",
          }}
        />
        <button
          className="btn"
          type="button"
          onClick={() => doSearch(query)}
          disabled={loading}
          style={{ padding: "8px 20px", fontWeight: 600 }}
        >
          {loading ? t("memory.searching", locale) : t("memory.search", locale)}
        </button>
      </div>

      {/* Quick questions */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 8 }}>
          {t("memory.quickQuestions", locale)}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {QUICK_QUESTIONS.map((qq) => (
            <button
              key={qq.key}
              type="button"
              className="btn btn-sm btn-outline"
              onClick={() => handleQuickQuestion(qq.zh)}
              style={{ fontSize: 12, cursor: "pointer" }}
            >
              {qq.zh}
            </button>
          ))}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div
          style={{
            padding: 16, background: "rgba(220,38,38,0.08)", borderRadius: 8,
            border: "1px solid rgba(220,38,38,0.3)", color: "var(--danger)",
            marginBottom: 16,
          }}
        >
          <strong>{t("memory.serverOffline", locale)}</strong>
          <p style={{ margin: "4px 0 0", fontSize: 13, opacity: 0.8 }}>{error}</p>
        </div>
      )}

      {/* Results */}
      {loading && (
        <div style={{ textAlign: "center", padding: 40, color: "var(--muted)" }}>
          {t("memory.searching", locale)}…
        </div>
      )}

      {results !== null && !loading && (
        <div>
          <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>
            {t("memory.resultCount", locale).replace("{n}", String(results.length))}
          </div>

          {results.length === 0 ? (
            <div
              style={{
                padding: 40, textAlign: "center", color: "var(--muted)",
                background: "var(--surface)", borderRadius: 8,
                border: "1px solid var(--border)",
              }}
            >
              {t("memory.noResults", locale)}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {results.map((r, i) => {
                const agent = r.agent_id || "unknown";
                return (
                  <div
                    key={r.id || i}
                    style={{
                      padding: "12px 16px", background: "var(--surface)",
                      borderRadius: 8, border: "1px solid var(--border)",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                      <span className={`badge badge-${agentColor(agent)}`}>
                        {agentLabel(agent)}
                      </span>
                      <span style={{ fontSize: 11, color: "var(--muted)" }}>
                        {r.score != null ? fmtScore(r.score) : ""}
                        {r.created_at ? ` · ${new Date(r.created_at).toLocaleString()}` : ""}
                      </span>
                    </div>
                    <div style={{ fontSize: 14, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                      {r.memory || r.text || JSON.stringify(r)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
