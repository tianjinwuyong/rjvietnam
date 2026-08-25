import { useEffect, useState } from "react";
import {
  Factory, Package, CheckCircle, AlertTriangle, Clock,
  ArrowRight, RefreshCw, XCircle, Loader2,
} from "lucide-react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { mesApi } from "../api";
import type { ProductionLine, FeederBinding } from "../api/mes";

interface BindingDetail {
  feederNo: string;
  reelCode: string;
  lotNo: string;
  materialCode: string;
  operator: string;
  boundAt: string;
}

interface LoadingProgress {
  lineCode: string;
  total: number;
  loaded: number;
  status: "not_started" | "in_progress" | "complete" | "error";
  workOrderCode?: string;
  activeOperators: string[];
  bindings: BindingDetail[];
}

export function MaterialLoadingDashboard({
  locale,
  onStartLoading,
}: {
  locale: Locale;
  onStartLoading: (lineCode: string) => void;
}) {
  const [lines, setLines] = useState<ProductionLine[]>([]);
  const [bindings, setBindings] = useState<FeederBinding[]>([]);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<Record<string, LoadingProgress>>({});
  const [expandedLines, setExpandedLines] = useState<Record<string, boolean>>({});

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [lineRes, bindRes] = await Promise.all([
        mesApi.getLines({ limit: 50 }),
        mesApi.getFeederBindings({ limit: 500 }),
      ]);
      setLines(lineRes.items);
      setBindings(bindRes.items);
      computeProgress(lineRes.items, bindRes.items);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }

  function computeProgress(linesData: ProductionLine[], binds: FeederBinding[]) {
    const map: Record<string, LoadingProgress> = {};
    for (const line of linesData) {
      const lineBinds = binds.filter((b) => b.lineCode === line.lineCode && !b.unboundAt);
      const wo = line.currentWorkOrderCode;
      const woBinds = wo ? lineBinds.filter((b) => b.workOrderCode === wo) : lineBinds;
      const activeOperators = [...new Set(woBinds.map((b) => b.operator).filter(Boolean))];
      const bindings: BindingDetail[] = woBinds.map((b) => ({
        feederNo: b.feederNo,
        reelCode: b.reelCode,
        lotNo: b.lotNo,
        materialCode: b.materialCode,
        operator: b.operator,
        boundAt: b.boundAt,
      }));
      map[line.lineCode] = {
        lineCode: line.lineCode,
        total: line.stationCount ?? 1,
        loaded: woBinds.length,
        status: woBinds.length === 0 ? "not_started" : woBinds.length >= (line.stationCount ?? 1) ? "complete" : "in_progress",
        workOrderCode: wo,
        activeOperators,
        bindings,
      };
    }
    setProgress(map);
  }

  const lineName = (line: ProductionLine) =>
    locale === "zh-CN" ? line.nameZh : locale === "en-US" ? line.nameEn : line.nameVi;

  const statusIcon = (status: LoadingProgress["status"]) => {
    switch (status) {
      case "complete": return <CheckCircle size={18} color="var(--ok)" />;
      case "in_progress": return <Clock size={18} color="var(--warn)" />;
      case "error": return <AlertTriangle size={18} color="var(--danger)" />;
      default: return <Package size={18} color="var(--muted)" />;
    }
  };

  const statusClass = (status: LoadingProgress["status"]) => {
    switch (status) {
      case "complete": return "badge-ok";
      case "in_progress": return "badge-warning";
      case "error": return "badge-danger";
      default: return "badge-info";
    }
  };

  return (
    <div className="screen-stack">
      {/* Header stats */}
      <div className="metric-grid">
        <article className="stat-card">
          <span>{t("common.total", locale)}</span>
          <strong>{lines.length}</strong>
          <span className="badge badge-info">{t("nav.mes", locale)}</span>
        </article>
        <article className="stat-card">
          <span>{t("mes.materialLoad.status.complete", locale)}</span>
          <strong>{Object.values(progress).filter((p) => p.status === "complete").length}</strong>
          <CheckCircle size={16} color="var(--ok)" />
        </article>
        <article className="stat-card">
          <span>{t("mes.materialLoad.status.inProgress", locale)}</span>
          <strong>{Object.values(progress).filter((p) => p.status === "in_progress").length}</strong>
          <Clock size={16} color="var(--warn)" />
        </article>
        <article className="stat-card">
          <span>{t("mes.materialLoad.status.notStarted", locale)}</span>
          <strong>{Object.values(progress).filter((p) => p.status === "not_started").length}</strong>
          <Package size={16} color="var(--muted)" />
        </article>
      </div>

      {/* Toolbar */}
      <div className="toolbar">
        <button type="button" className="action-button" onClick={loadData} disabled={loading}>
          <RefreshCw size={14} />
          {t("common.refresh", locale)}
        </button>
      </div>

      {/* Line cards */}
      <section className="surface-panel">
        <div className="section-header">
          <h2>{t("mes.materialLoad.title", locale)}</h2>
          <p>{t("mes.materialLoad.selectLine", locale)}</p>
        </div>

        {loading ? (
          <div className="placeholder-view">
            <Loader2 size={32} className="spin" />
            <p>{t("common.loading", locale)}</p>
          </div>
        ) : lines.length === 0 ? (
          <div className="placeholder-view">
            <Factory size={40} />
            <p>{t("common.noData", locale)}</p>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {lines.map((line) => {
              const p = progress[line.lineCode] ?? {
                total: 1, loaded: 0, status: "not_started" as const, activeOperators: [] as string[], bindings: [] as BindingDetail[],
              };
              const pct = p.total > 0 ? Math.round((p.loaded / p.total) * 100) : 0;
              return (
                <>
                <article
                  key={line.id}
                  style={{
                    display: "flex", alignItems: "center", gap: 16,
                    padding: "16px 20px", borderRadius: 12,
                    background: "var(--surface-2)", cursor: "pointer",
                    transition: "box-shadow 0.15s, transform 0.1s",
                    border: "1px solid var(--border)",
                  }}
                  onClick={() => onStartLoading(line.lineCode)}
                  onMouseEnter={(e) => { e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.08)"; e.currentTarget.style.transform = "translateY(-1px)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.boxShadow = "none"; e.currentTarget.style.transform = "none"; }}
                >
                  {statusIcon(p.status)}

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <strong style={{ fontSize: 16 }}>{lineName(line)}</strong>
                      <span className={`badge ${statusClass(p.status)}`} style={{ fontSize: 11 }}>
                        {t(
                          p.status === "complete"
                            ? "mes.materialLoad.status.complete"
                            : p.status === "in_progress"
                              ? "mes.materialLoad.status.inProgress"
                              : "mes.materialLoad.status.notStarted",
                          locale,
                        )}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 16, fontSize: 13, color: "var(--muted)", flexWrap: "wrap" }}>
                      <span>{line.lineCode}</span>
                      {p.workOrderCode && <span>WO: {p.workOrderCode}</span>}
                      <span>{line.stationCount ?? "—"} {t("nav.mes", locale)}</span>
                      {p.activeOperators.length > 0 && (
                        <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
                          {p.activeOperators.map((op) => (
                            <span key={op} style={{
                              background: "var(--warn)", color: "#fff",
                              borderRadius: 10, padding: "1px 8px", fontSize: 11, fontWeight: 700,
                            }}>
                              📱 {op}
                            </span>
                          ))}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div style={{ flex: "0 0 140px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                      <span>{t("mes.materialLoad.loadedCount", locale)}: {p.loaded}</span>
                      <span>{t("mes.materialLoad.totalCount", locale)}: {p.total}</span>
                    </div>
                    <div style={{
                      height: 6, borderRadius: 3, background: "var(--line)", overflow: "hidden",
                    }}>
                      <div style={{
                        height: "100%", borderRadius: 3, width: `${pct}%`,
                        background: p.status === "complete" ? "var(--ok)" : p.status === "in_progress" ? "var(--warn)" : "var(--muted)",
                        transition: "width 0.3s",
                      }} />
                    </div>
                  </div>

                  <ArrowRight size={18} color="var(--muted)" style={{ flexShrink: 0 }} />

                  {/* Expand toggle — show bindings on click */}
                  {p.bindings.length > 0 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedLines((prev) => ({ ...prev, [line.lineCode]: !prev[line.lineCode] }));
                      }}
                      style={{
                        background: "none", border: "none", cursor: "pointer",
                        color: "var(--muted)", fontSize: 11, padding: "2px 6px",
                        borderRadius: 4, flexShrink: 0,
                      }}
                    >
                      {expandedLines[line.lineCode] ? "▲ 收起" : "▼ 查看绑定"}
                    </button>
                  )}
                </article>

                {/* Binding detail list — shown when expanded */}
                {expandedLines[line.lineCode] && p.bindings.length > 0 && (
                  <div style={{
                    margin: "-4px 0 8px 0", padding: "12px 16px", borderRadius: "0 0 12px 12px",
                    background: "var(--surface-3)", border: "1px solid var(--border)",
                    borderTop: "none", fontSize: 12,
                  }}>
                    <div style={{ display: "grid", gap: 6 }}>
                      <div style={{ display: "grid", gridTemplateColumns: "60px 1fr 120px 100px 80px", gap: 8, fontWeight: 700, color: "var(--muted)", paddingBottom: 4, borderBottom: "1px solid var(--border)" }}>
                        <span>槽位</span>
                        <span>物料</span>
                        <span>批次</span>
                        <span>REEL</span>
                        <span>操作员</span>
                      </div>
                      {p.bindings.map((b, i) => (
                        <div key={i} style={{ display: "grid", gridTemplateColumns: "60px 1fr 120px 100px 80px", gap: 8, alignItems: "center", padding: "3px 0", borderBottom: "1px solid var(--border)" }}>
                          <span style={{ fontFamily: "monospace", fontWeight: 700, color: "var(--warn)" }}>{b.feederNo}</span>
                          <span title={b.materialCode} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.materialCode}</span>
                          <span style={{ fontFamily: "monospace", color: "var(--muted)" }}>{b.lotNo}</span>
                          <span title={b.reelCode} style={{ fontFamily: "monospace", color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.reelCode}</span>
                          <span>{b.operator}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                </>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
