import { useEffect, useState, useCallback, useRef } from "react";
import {
  Factory, Package, CheckCircle, Clock, AlertTriangle, RefreshCw,
  Loader2, ArrowRight, ArrowLeft, Users, Monitor,
} from "lucide-react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";

// ── Types ────────────────────────────────────────────────────────────

interface DispatchProgress {
  total: number;
  loaded: number;
  pending: number;
}

interface PdaInfo {
  pdaId: string;
  operator: string;
  lineCode: string | null;
  lastSeen: number;
}

interface DispatchAssignment {
  id: number;
  materialCode: string;
  materialNameZh: string;
  smtFlag: string;
  unit: string | null;
  assignedOperator: string | null;
  assignedPda: string | null;
  claimOperator: string | null;
  claimPda: string | null;
  claimedAt: string | null;
  status: "pending" | "loading" | "loaded";
  feederSlot: string | null;
  lotNo: string | null;
  loadedAt: string | null;
}

interface DispatchSession {
  id: number;
  workOrderCode: string;
  lineCode: string | null;
  status: string;
  createdAt: string;
  pdas: PdaInfo[];
  assignments: DispatchAssignment[];
  progress: DispatchProgress;
}

// ── API ─────────────────────────────────────────────────────────────

async function apiGetSessions(): Promise<DispatchSession[]> {
  const res = await fetch("/api/dispatch/sessions");
  const data = await res.json();
  if (!data.success) throw new Error(data.error || "Failed to load sessions");
  return data.sessions;
}

async function apiGetSession(id: number): Promise<DispatchSession> {
  const res = await fetch(`/api/dispatch/sessions/${id}`);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || "Failed to load session");
  return data.session;
}

async function apiCompleteSession(id: number): Promise<void> {
  const res = await fetch(`/api/dispatch/sessions/${id}/complete`, { method: "POST" });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || "Failed to complete session");
}

// ── SSE ─────────────────────────────────────────────────────────────

function useDispatchSse(onEvent: (type: string) => void) {
  const es = useRef<EventSource | null>(null);

  useEffect(() => {
    const types = [
      "DISPATCH_SESSION_STARTED", "MATERIAL_CLAIMED", "MATERIAL_LOADED",
      "MATERIAL_RELEASED", "ASSIGNMENTS_UPDATED", "PDA_JOINED",
      "PDA_LEFT", "DISPATCH_SESSION_COMPLETED",
    ].join(",");
    const sse = new EventSource(`/api/pda/events?node=mes_dispatch&types=${types}`);
    sse.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type) onEvent(msg.type);
      } catch { /* ignore parse errors */ }
    };
    es.current = sse;
    return () => { es.current?.close(); };
  }, [onEvent]);
}

// ── Helpers ─────────────────────────────────────────────────────────

const SMT_FLAG_COLORS: Record<string, string> = {
  SMT: "#3b82f6",
  THT: "#8b5cf6",
  CONNECTOR: "#06b6d4",
  CABLE: "#f59e0b",
  MECHANICAL: "#10b981",
  OTHERS: "#6b7280",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "var(--warn)",
  loading: "var(--nav)",
  loaded: "var(--ok)",
};

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? "var(--muted)";
  const label = status;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "2px 8px", borderRadius: 12, fontSize: 11, fontWeight: 600,
      background: color + "22", color,
    }}>
      {status === "loaded" ? <CheckCircle size={11} /> : status === "loading" ? <Clock size={11} /> : <Package size={11} />}
      {label}
    </span>
  );
}

function SmtFlagBadge({ flag }: { flag: string }) {
  const color = SMT_FLAG_COLORS[flag] ?? SMT_FLAG_COLORS.OTHERS;
  return (
    <span style={{
      display: "inline-block",
      padding: "1px 6px", borderRadius: 4, fontSize: 10, fontWeight: 700,
      background: color + "22", color,
    }}>
      {flag}
    </span>
  );
}

function ProgressBar({ loaded, total, showLabel = true }: { loaded: number; total: number; showLabel?: boolean }) {
  const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
  return (
    <div>
      {showLabel && (
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
          <span style={{ color: "var(--ok)" }}>✓ {loaded}</span>
          <span>{pct}%</span>
          <span style={{ color: "var(--muted)" }}>{total - loaded} pending</span>
        </div>
      )}
      <div style={{ height: 8, borderRadius: 4, background: "var(--line)", overflow: "hidden" }}>
        <div style={{
          height: "100%", borderRadius: 4, width: `${pct}%`,
          background: pct === 100 ? "var(--ok)" : "var(--nav)",
          transition: "width 0.4s",
        }} />
      </div>
    </div>
  );
}

// ── Session List View ────────────────────────────────────────────────

function SessionCard({
  session,
  locale,
  onClick,
}: {
  session: DispatchSession;
  locale: Locale;
  onClick: () => void;
}) {
  const { progress, pdas } = session;
  const pct = progress.total > 0 ? Math.round((progress.loaded / progress.total) * 100) : 0;
  const lineName = session.lineCode ?? "—";

  return (
    <article
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 16,
        padding: "16px 20px", borderRadius: 12,
        background: "var(--surface-2)", cursor: "pointer",
        border: "1px solid var(--border)",
        transition: "box-shadow 0.15s, transform 0.1s",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.08)"; e.currentTarget.style.transform = "translateY(-1px)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.boxShadow = "none"; e.currentTarget.style.transform = "none"; }}
    >
      {/* Status icon */}
      <div style={{ flexShrink: 0 }}>
        {progress.loaded === progress.total && progress.total > 0 ? (
          <CheckCircle size={24} color="var(--ok)" />
        ) : progress.loaded > 0 ? (
          <Clock size={24} color="var(--warn)" />
        ) : (
          <Package size={24} color="var(--muted)" />
        )}
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <strong style={{ fontSize: 15 }}>{session.workOrderCode}</strong>
          <span className="badge badge-info" style={{ fontSize: 10 }}>{lineName}</span>
          {session.status === "active" ? (
            <span className="badge badge-ok" style={{ fontSize: 10 }}>{t("mes.dispatchBoard.active", locale)}</span>
          ) : (
            <span className="badge badge-info" style={{ fontSize: 10 }}>{session.status}</span>
          )}
        </div>
        <div style={{ display: "flex", gap: 16, fontSize: 12, color: "var(--muted)" }}>
          <span>ID: {session.id}</span>
          <span>{(new Date(session.createdAt)).toLocaleTimeString()}</span>
          {pdas.length > 0 && (
            <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
              <Users size={11} /> {pdas.length} PDA{pdas.length > 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>

      {/* Progress */}
      <div style={{ flex: "0 0 200px" }}>
        <ProgressBar loaded={progress.loaded} total={progress.total} />
      </div>

      <ArrowRight size={18} color="var(--muted)" style={{ flexShrink: 0 }} />
    </article>
  );
}

// ── Session Detail View ─────────────────────────────────────────────

function SessionDetail({
  session: initialSession,
  locale,
  onBack,
  onRefresh,
}: {
  session: DispatchSession;
  locale: Locale;
  onBack: () => void;
  onRefresh: () => void;
}) {
  const [completing, setCompleting] = useState(false);
  const [session, setSession] = useState(initialSession);

  // DEBUG
  console.log("[SessionDetail] session assignments:", session.assignments?.length, "pdas:", session.pdas?.length, "loaded:", session.progress?.loaded);

  // SSE: listen for material loading events and refresh
  useEffect(() => {
    const types = ["MATERIAL_LOADED", "ASSIGNMENTS_UPDATED"].join(",");
    const es = new EventSource(`/api/pda/events?node=mes_dispatch_${initialSession.id}&types=${types}`);
    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "MATERIAL_LOADED" || msg.type === "ASSIGNMENTS_UPDATED") {
          apiGetSession(initialSession.id).then(fresh => {
            console.log("[SSE] fresh type:", typeof fresh, "keys:", fresh ? Object.keys(fresh).join(',') : null, "assignments:", fresh?.assignments?.length);
            setSession(fresh ?? initialSession);
          }).catch(e => { console.error("[SSE refresh error]", e.message); });
        }
      } catch { /* ignore */ }
    };
    return () => { es.close(); };
  }, [initialSession.id]);

  // Polling fallback: guarantee fresh data every 5s
  useEffect(() => {
    const id = setInterval(() => {
      apiGetSession(initialSession.id).then(fresh => {
        if (fresh) {
          console.log("[Poll] fresh keys:", Object.keys(fresh).join(','), "assignments:", fresh?.assignments?.length, "loaded:", fresh?.progress?.loaded);
          if (fresh.progress?.loaded !== session.progress?.loaded) {
            setSession(fresh);
          }
        }
      }).catch(e => { console.error("[Polling error]", e.message); });
    }, 5000);
    return () => clearInterval(id);
  }, [initialSession.id, session.progress?.loaded]);
  useEffect(() => {
    const types = ["MATERIAL_LOADED", "ASSIGNMENTS_UPDATED"].join(",");
    const es = new EventSource(`/api/pda/events?node=mes_dispatch_${initialSession.id}&types=${types}`);
    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "MATERIAL_LOADED" || msg.type === "ASSIGNMENTS_UPDATED") {
          apiGetSession(initialSession.id).then(fresh => {
            setSession(fresh ?? initialSession);
          }).catch(() => {});
        }
      } catch { /* ignore */ }
    };
    return () => { es.close(); };
  }, [initialSession.id]);

  // Polling fallback: guarantee fresh data every 5s
  useEffect(() => {
    const id = setInterval(() => {
      apiGetSession(initialSession.id).then(fresh => {
        if (fresh && fresh.progress?.loaded !== session.progress?.loaded) {
          setSession(fresh);
        }
      }).catch(() => {});
    }, 5000);
    return () => clearInterval(id);
  }, [initialSession.id, session.progress?.loaded]);

  const handleComplete = async () => {
    if (!confirm(t("mes.dispatchBoard.confirmComplete", locale) ?? "Mark this session as complete?")) return;
    setCompleting(true);
    try {
      await apiCompleteSession(session.id);
      onRefresh();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setCompleting(false);
    }
  };

  const { progress, pdas, assignments = [] } = session;
  const pct = progress.total > 0 ? Math.round((progress.loaded / progress.total) * 100) : 0;

  // Group assignments by status
  const pending = assignments.filter(a => a.status === "pending");
  const loading = assignments.filter(a => a.status === "loading");
  const loaded = assignments.filter(a => a.status === "loaded");

  // Group by smtFlag for summary
  const byFlag: Record<string, number> = {};
  for (const a of assignments) {
    byFlag[a.smtFlag] = (byFlag[a.smtFlag] ?? 0) + 1;
  }

  return (
    <div className="screen-stack">
      {/* Header */}
      <section className="surface-panel">
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <button type="button" className="action-button" onClick={onBack}>
            <ArrowLeft size={14} /> {t("common.back", locale)}
          </button>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <h2 style={{ margin: 0 }}>{session.workOrderCode}</h2>
              <span className="badge badge-info">{session.lineCode ?? "—"}</span>
              {session.status === "active" ? (
                <span className="badge badge-ok">{t("mes.dispatchBoard.active", locale)}</span>
              ) : (
                <span className="badge badge-info">{session.status}</span>
              )}
            </div>
            <p style={{ fontSize: 12, color: "var(--muted)", margin: "4px 0 0" }}>
              Session #{session.id} · Created {(new Date(session.createdAt)).toLocaleString()}
            </p>
          </div>
          <button type="button" className="action-button" onClick={onRefresh} disabled={completing}>
            <RefreshCw size={14} className={completing ? "spin" : ""} />
            {t("common.refresh", locale)}
          </button>
          {session.status === "active" && (
            <button
              type="button"
              className="action-button"
              style={{ background: "var(--ok)", color: "#fff" }}
              onClick={handleComplete}
              disabled={completing || progress.loaded < progress.total}
              title={progress.loaded < progress.total ? t("mes.dispatchBoard.completeHint", locale) ?? "All materials must be loaded first" : ""}
            >
              <CheckCircle size={14} />
              {completing ? "..." : t("mes.dispatchBoard.markComplete", locale)}
            </button>
          )}
        </div>

        {/* Summary stats */}
        <div className="metric-grid" style={{ gridTemplateColumns: "repeat(5, 1fr)", margin: 0 }}>
          <article className="stat-card" style={{ padding: "8px 12px" }}>
            <span>{t("common.total", locale)}</span>
            <strong>{progress.total}</strong>
          </article>
          <article className="stat-card" style={{ padding: "8px 12px" }}>
            <span>{t("mes.dispatchBoard.loaded", locale)}</span>
            <strong style={{ color: "var(--ok)" }}>{progress.loaded}</strong>
          </article>
          <article className="stat-card" style={{ padding: "8px 12px" }}>
            <span>{t("mes.dispatchBoard.loading", locale)}</span>
            <strong style={{ color: "var(--nav)" }}>{loading.length}</strong>
          </article>
          <article className="stat-card" style={{ padding: "8px 12px" }}>
            <span>{t("common.pending", locale)}</span>
            <strong style={{ color: "var(--warn)" }}>{pending.length}</strong>
          </article>
          <article className="stat-card" style={{ padding: "8px 12px" }}>
            <span>{t("mes.dispatchBoard.pdas", locale)}</span>
            <strong style={{ color: "var(--nav)" }}>{pdas.length}</strong>
          </article>
        </div>

        {/* Overall progress */}
        <div style={{ marginTop: 12 }}>
          <ProgressBar loaded={progress.loaded} total={progress.total} showLabel />
        </div>

        {/* SMT flags summary */}
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          {Object.entries(byFlag).map(([flag, count]) => (
            <span key={flag} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}>
              <SmtFlagBadge flag={flag} /> ×{count}
            </span>
          ))}
        </div>
      </section>

      {/* Active PDAs */}
      {pdas.length > 0 && (
        <section className="surface-panel">
          <div className="section-header">
            <h3>
              <Users size={16} style={{ verticalAlign: "middle", marginRight: 6 }} />
              {t("mes.dispatchBoard.activePdas", locale)}
            </h3>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {pdas.map(pda => (
              <article
                key={pda.pdaId}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "10px 14px", borderRadius: 8,
                  background: "var(--surface-2)", border: "1px solid var(--border)",
                }}
              >
                <Monitor size={16} color="var(--nav)" />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{pda.operator ?? pda.pdaId}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>{pda.pdaId}</div>
                </div>
                {pda.lineCode && (
                  <span className="badge badge-info" style={{ fontSize: 10 }}>{pda.lineCode}</span>
                )}
              </article>
            ))}
          </div>
        </section>
      )}

      {/* Per-operator vivid progress bars */}
      {pdas.length > 0 && (
        <section className="surface-panel">
          <div className="section-header">
            <h3>{t("mes.dispatchBoard.operatorProgress", locale)}</h3>
            <style>{`
              @keyframes pulse-ring {
                0% { box-shadow: 0 0 0 0 rgba(59,130,246,0.5); }
                70% { box-shadow: 0 0 0 8px rgba(59,130,246,0); }
                100% { box-shadow: 0 0 0 0 rgba(59,130,246,0); }
              }
              @keyframes slide-in {
                from { opacity: 0; transform: translateY(-4px); }
                to { opacity: 1; transform: translateY(0); }
              }
              @keyframes count-up {
                from { transform: translateY(4px); opacity: 0; }
                to { transform: translateY(0); opacity: 1; }
              }
            `}</style>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {pdas.map(pda => {
              const assigned = assignments.filter(a => a.assignedPda === pda.pdaId);
              const loaded = assigned.filter(a => a.status === "loaded").length;
              const loading = assigned.filter(a => a.status === "loading").length;
              const pending = assigned.filter(a => a.status === "pending").length;
              const total = assigned.length;
              const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
              const isActive = loading > 0 || loaded < total;

              // Color each operator's bar distinctly
              const pdaColors: Record<string, { loaded: string; pending: string }> = {
                PDA001: { loaded: "#10b981", pending: "#34d399" },
                PDA002: { loaded: "#3b82f6", pending: "#60a5fa" },
                PDA003: { loaded: "#8b5cf6", pending: "#a78bfa" },
                PDA004: { loaded: "#f59e0b", pending: "#fbbf24" },
                PDA005: { loaded: "#ef4444", pending: "#f87171" },
              };
              const colors = pdaColors[pda.pdaId] ?? { loaded: "var(--ok)", pending: "var(--nav)" };

              // Material name: show next pending or current loading material
              const nextPending = assigned.find(a => a.status === "pending");
              const currentLoading = assigned.find(a => a.status === "loading");
              const displayMat = currentLoading ?? nextPending;
              const matName = displayMat?.materialCode ?? "—";
              const matShort = matName.length > 18 ? matName.substring(0, 16) + "…" : matName;

              return (
                <div
                  key={pda.pdaId}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "120px 1fr 80px",
                    gap: 12,
                    alignItems: "center",
                    padding: "10px 14px",
                    borderRadius: 10,
                    background: "var(--surface-2)",
                    border: `1px solid ${isActive ? colors.loaded + "44" : "var(--border)"}`,
                    boxShadow: isActive ? `0 0 12px ${colors.loaded}18` : "none",
                    transition: "all 0.3s",
                  }}
                >
                  {/* Operator info */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
                      {pda.operator ?? pda.pdaId}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>{pda.pdaId}</span>
                    {loading > 0 && (
                      <span style={{
                        fontSize: 10, color: colors.loaded, fontWeight: 600,
                        animation: "pulse-ring 1.5s infinite",
                        borderRadius: 4, padding: "1px 4px",
                        background: colors.loaded + "18",
                      }}>
                        {t("mes.dispatchBoard.loading2", locale)}
                      </span>
                    )}
                  </div>

                  {/* Bar with labels */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {/* Loaded count at top */}
                    <div style={{
                      display: "flex", justifyContent: "space-between", fontSize: 11,
                      animation: loaded > 0 ? "count-up 0.3s ease" : "none",
                    }}>
                      <span style={{ color: "var(--muted)", fontSize: 10 }}>
                        {t("mes.dispatchBoard.loaded", locale)}
                      </span>
                      <span style={{ fontWeight: 700, color: colors.loaded, fontSize: 13 }}>
                        {loaded} <span style={{ color: "var(--muted)", fontWeight: 400 }}>/ {total}</span>
                      </span>
                    </div>

                    {/* Stacked progress bar */}
                    <div style={{
                      height: 20, borderRadius: 6, background: "var(--line)",
                      overflow: "hidden", display: "flex",
                    }}>
                      {total > 0 && (
                        <>
                          {/* Loaded segment */}
                          <div style={{
                            width: `${pct}%`,
                            background: `linear-gradient(90deg, ${colors.loaded}dd, ${colors.loaded})`,
                            transition: "width 0.6s cubic-bezier(0.4,0,0.2,1)",
                            display: "flex", alignItems: "center", justifyContent: "flex-end",
                            paddingRight: 6,
                          }}>
                            {pct >= 15 && (
                              <span style={{ fontSize: 10, fontWeight: 700, color: "#fff", fontVariantNumeric: "tabular-nums" }}>
                                {loaded}
                              </span>
                            )}
                          </div>
                          {/* Pending segment */}
                          <div style={{
                            flex: 1,
                            background: `linear-gradient(90deg, ${colors.pending}88, ${colors.pending}44)`,
                            display: "flex", alignItems: "center", paddingLeft: 6,
                          }}>
                            {pct < 85 && (
                              <span style={{ fontSize: 10, fontWeight: 600, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>
                                {pending > 0 ? `+${pending}` : ""}
                              </span>
                            )}
                          </div>
                        </>
                      )}
                    </div>

                    {/* Material name at bottom */}
                    <div style={{
                      fontSize: 10, color: "var(--muted)",
                      display: "flex", alignItems: "center", gap: 4,
                    }}>
                      <Package size={9} />
                      <span style={{
                        maxWidth: 280,
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>
                        {currentLoading
                          ? `${t("mes.dispatchBoard.loading2", locale)}: ${matShort}`
                          : nextPending
                            ? `${t("mes.dispatchBoard.pending", locale)}: ${matShort}`
                            : t("mes.dispatchBoard.allLoaded", locale) ?? "All loaded"}
                      </span>
                    </div>
                  </div>

                  {/* Mini stats */}
                  <div style={{
                    display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end",
                  }}>
                    <div style={{
                      fontSize: 20, fontWeight: 800, lineHeight: 1,
                      color: pct === 100 ? "var(--ok)" : colors.loaded,
                      fontVariantNumeric: "tabular-nums",
                      transition: "color 0.3s",
                    }}>
                      {pct}%
                    </div>
                    {pct === 100 && (
                      <CheckCircle size={14} color="var(--ok)" />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Assignments table */}
      <section className="surface-panel">
        <div className="section-header">
          <h3>{t("mes.dispatchBoard.assignments", locale)}</h3>
          <div style={{ display: "flex", gap: 6 }}>
            {[
              { label: t("mes.dispatchBoard.all", locale) + ` (${assignments.length})`, count: assignments.length, color: "var(--text)" },
              { label: t("mes.dispatchBoard.pending", locale) + ` (${pending.length})`, count: pending.length, color: "var(--warn)" },
              { label: t("mes.dispatchBoard.loading2", locale) + ` (${loading.length})`, count: loading.length, color: "var(--nav)" },
              { label: t("mes.dispatchBoard.loaded", locale) + ` (${loaded.length})`, count: loaded.length, color: "var(--ok)" },
            ].map(({ label, count, color }) => (
              count > 0 && (
                <span
                  key={label}
                  style={{
                    padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 600,
                    background: color + "18", color,
                  }}
                >
                  {label}
                </span>
              )
            ))}
          </div>
        </div>
        <div className="table-shell" style={{ maxHeight: 500, overflow: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>{t("common.status", locale)}</th>
                <th>Material</th>
                <th>{t("mes.dispatchBoard.materialName", locale)}</th>
                <th>Flag</th>
                <th>{t("mes.dispatchBoard.assignedTo", locale)}</th>
                <th>{t("mes.dispatchBoard.claimedBy", locale)}</th>
                <th>Slot</th>
                <th>Lot</th>
              </tr>
            </thead>
            <tbody>
              {assignments.map(a => (
                <tr
                  key={a.id}
                  style={{
                    background: a.status === "loaded"
                      ? "rgba(11,122,83,0.04)"
                      : a.status === "loading"
                        ? "rgba(59,130,246,0.04)"
                        : undefined,
                  }}
                >
                  <td><StatusBadge status={a.status} /></td>
                  <td><strong style={{ fontSize: 12 }}>{a.materialCode}</strong></td>
                  <td style={{ fontSize: 12 }}>{a.materialNameZh ?? "—"}</td>
                  <td><SmtFlagBadge flag={a.smtFlag} /></td>
                  <td style={{ fontSize: 12 }}>{a.assignedOperator ?? a.assignedPda ?? "—"}</td>
                  <td style={{ fontSize: 12 }}>
                    {a.claimOperator ?? a.claimPda ? (
                      <span style={{ color: "var(--nav)" }}>{a.claimOperator ?? a.claimPda}</span>
                    ) : "—"}
                  </td>
                  <td style={{ fontSize: 11, color: "var(--muted)" }}>{a.feederSlot ?? "—"}</td>
                  <td style={{ fontSize: 11, color: "var(--muted)" }}>{a.lotNo ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

// ── Main Dispatch Board ─────────────────────────────────────────────

export function MaterialDispatchBoard({ locale }: { locale: Locale }) {
  const [sessions, setSessions] = useState<DispatchSession[]>([]);
  const [selectedSession, setSelectedSession] = useState<DispatchSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const refreshKey = useRef(0);

  const selectedSessionRef = useRef<DispatchSession | null>(null);
  selectedSessionRef.current = selectedSession;

  const loadSessions = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiGetSessions();
      setSessions(data);
      setLastRefresh(new Date());
      // Refresh selected session if any (use ref to avoid stale closure)
      if (selectedSessionRef.current) {
        const updated = data.find(s => s.id === selectedSessionRef.current!.id);
        if (updated) setSelectedSession(updated);
      }
    } catch (e: any) {
      setError(e.message ?? "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  // Reload on SSE events
  const handleSseEvent = useCallback(() => {
    refreshKey.current += 1;
    loadSessions();
  }, [loadSessions]);

  useDispatchSse(handleSseEvent);

  // Initial load + auto-refresh every 10s
  useEffect(() => {
    loadSessions();
    const interval = setInterval(loadSessions, 10_000);
    return () => clearInterval(interval);
  }, [loadSessions]);

  // If a session is selected, show detail view
  if (selectedSession) {
    return (
      <SessionDetail
        session={selectedSession}
        locale={locale}
        onBack={() => setSelectedSession(null)}
        onRefresh={loadSessions}
      />
    );
  }

  // Session list view
  const activeSessions = sessions.filter(s => s.status === "active");
  const completedSessions = sessions.filter(s => s.status !== "active");

  return (
    <div className="screen-stack">
      {/* Stats header */}
      <div className="metric-grid">
        <article className="stat-card">
          <span>{t("mes.dispatchBoard.totalSessions", locale)}</span>
          <strong>{sessions.length}</strong>
        </article>
        <article className="stat-card">
          <span>{t("mes.dispatchBoard.activeSessions", locale)}</span>
          <strong style={{ color: "var(--ok)" }}>{activeSessions.length}</strong>
        </article>
        <article className="stat-card">
          <span>{t("mes.dispatchBoard.completedSessions", locale)}</span>
          <strong style={{ color: "var(--muted)" }}>{completedSessions.length}</strong>
        </article>
        <article className="stat-card">
          <span>{t("mes.dispatchBoard.totalPdas", locale)}</span>
          <strong style={{ color: "var(--nav)" }}>{sessions.reduce((s, x) => s + x.pdas.length, 0)}</strong>
        </article>
        <article className="stat-card">
          <span>{t("mes.dispatchBoard.totalMaterials", locale)}</span>
          <strong>{sessions.reduce((s, x) => s + x.progress.total, 0)}</strong>
        </article>
      </div>

      {/* Toolbar */}
      <section className="surface-panel">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <h2 style={{ margin: 0 }}>
              <Factory size={18} style={{ verticalAlign: "middle", marginRight: 6 }} />
              {t("mes.dispatchBoard.title", locale)}
            </h2>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              {t("mes.dispatchBoard.lastRefresh", locale)}: {lastRefresh.toLocaleTimeString()}
            </span>
          </div>
          <button type="button" className="action-button" onClick={loadSessions} disabled={loading}>
            <RefreshCw size={14} className={loading ? "spin" : ""} />
            {t("common.refresh", locale)}
          </button>
        </div>
      </section>

      {/* Active sessions */}
      {activeSessions.length > 0 && (
        <section className="surface-panel">
          <div className="section-header">
            <h3>
              <Clock size={16} style={{ verticalAlign: "middle", marginRight: 6 }} color="var(--warn)" />
              {t("mes.dispatchBoard.activeSessions", locale)} ({activeSessions.length})
            </h3>
          </div>
          <div style={{ display: "grid", gap: 12 }}>
            {activeSessions.map(s => (
              <SessionCard
                key={s.id}
                session={s}
                locale={locale}
                onClick={() => setSelectedSession(s)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Completed sessions */}
      {completedSessions.length > 0 && (
        <section className="surface-panel">
          <div className="section-header">
            <h3>
              <CheckCircle size={16} style={{ verticalAlign: "middle", marginRight: 6 }} color="var(--ok)" />
              {t("mes.dispatchBoard.completedSessions", locale)} ({completedSessions.length})
            </h3>
          </div>
          <div style={{ display: "grid", gap: 12 }}>
            {completedSessions.map(s => (
              <SessionCard
                key={s.id}
                session={s}
                locale={locale}
                onClick={() => setSelectedSession(s)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Empty state */}
      {!loading && sessions.length === 0 && (
        <section className="surface-panel">
          <div className="placeholder-view" style={{ padding: 60 }}>
            <Monitor size={48} color="var(--muted)" />
            <p style={{ color: "var(--muted)", marginTop: 12 }}>
              {t("mes.dispatchBoard.noSessions", locale) ?? "No dispatch sessions found"}
            </p>
            <p style={{ fontSize: 12, color: "var(--muted)" }}>
              Sessions are created when PDAs join a WO for material loading
            </p>
          </div>
        </section>
      )}

      {/* Loading */}
      {loading && sessions.length === 0 && (
        <section className="surface-panel">
          <div className="placeholder-view" style={{ padding: 60 }}>
            <Loader2 size={40} className="spin" />
            <p>{t("common.loading", locale)}</p>
          </div>
        </section>
      )}

      {/* Error */}
      {error && (
        <section className="surface-panel">
          <div className="placeholder-view" style={{ padding: 40 }}>
            <AlertTriangle size={40} color="var(--danger)" />
            <p style={{ color: "var(--danger)", marginTop: 8 }}>{error}</p>
            <button type="button" className="action-button" onClick={loadSessions} style={{ marginTop: 12 }}>
              {t("common.retry", locale) ?? "Retry"}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
