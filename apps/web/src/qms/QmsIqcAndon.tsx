/**
 * QmsIqcAndon — IQC Andon 实时预警面板
 * 
 * P3: Andon实时预警 + CAPA自动闭环
 * - 3类预警：SPC超限 / 超时未检 / 计量设备到期
 * - Critical → 自动触发8D/CAPA
 * - 告警确认 → 解决全流程
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  AlertTriangle, AlertCircle, Clock, ShieldCheck, CheckCircle2, XCircle,
  Bell, BellOff, RefreshCw, Settings, ChevronDown, Zap
} from "lucide-react";
import { useTranslation } from "react-i18next";

interface Alert { id: number; material_code: string; parameter_code: string; alert_type: string; severity: string; description: string; created_at: string; acknowledged: boolean; resolved: boolean; }
interface TimeoutWarning { id: number; lot_no: string; material_code: string; supplier_code: string; supplier_name: string; inspection_date: string; hours_pending: number; inspector_name: string; }
interface CalWarning { id: number; equipment_code: string; equipment_name: string; equipment_type: string; calibration_status: string; next_calibration_date: string; status: string; }
interface Stats { criticalAlerts: number; warningAlerts: number; timeoutWarnings: number; calibrationDue: number; mesLocks: number; }

const SEVERITY_COLOR: Record<string, string> = { critical: "#dc2626", warning: "#f59e0b" };
const STATUS_COLOR: Record<string, string> = { acknowledged: "#64748b", unresolved: "#f59e0b", resolved: "#16a34a" };

function AndonCard({ children, severity, onClick }: { children: React.ReactNode; severity: string; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: "#1e293b",
        border: `2px solid ${SEVERITY_COLOR[severity] || "#334155"}`,
        borderRadius: 12,
        padding: 16,
        cursor: onClick ? "pointer" : "default",
        animation: severity === "critical" ? "pulse-red 2s infinite" : "none",
      }}>
      {children}
    </div>
  );
}

function AlertRow({ alert, onAcknowledge, onResolve }: { alert: Alert; onAcknowledge: (id: number) => void; onResolve: (id: number) => void }) {
  return (
    <div style={{
      background: "#0f172a",
      borderRadius: 8,
      padding: "12px 16px",
      marginBottom: 8,
      borderLeft: `4px solid ${SEVERITY_COLOR[alert.severity] || "#334155"}`,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            {alert.severity === "critical"
              ? <AlertCircle size={16} color="#dc2626" />
              : <AlertTriangle size={16} color="#f59e0b" />}
            <span style={{ color: "#e2e8f0", fontWeight: 600, fontSize: 14 }}>[{alert.alert_type}]</span>
            <span style={{ color: "#94a3b8", fontSize: 13, marginLeft: 8 }}>{alert.material_code} / {alert.parameter_code}</span>
          </div>
          <div style={{ color: "#64748b", fontSize: 12, marginLeft: 24 }}>{alert.description}</div>
          <div style={{ color: "#475569", fontSize: 11, marginLeft: 24, marginTop: 4 }}>
            {alert.created_at ? new Date(alert.created_at).toLocaleString() : "-"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0, marginLeft: 12 }}>
          {alert.acknowledged && !alert.resolved && (
            <button onClick={() => onResolve(alert.id)}
              style={{ padding: "5px 12px", background: "#16a34a", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>
              解决
            </button>
          )}
          {!alert.acknowledged && (
            <button onClick={() => onAcknowledge(alert.id)}
              style={{ padding: "5px 12px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>
              确认
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function QmsIqcAndon() {
  const { i18n } = useTranslation();
  const [tab, setTab] = useState<"alerts" | "timeout" | "calibration">("alerts");
  const [stats, setStats] = useState<Stats | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [timeouts, setTimeouts] = useState<TimeoutWarning[]>([]);
  const [calibrations, setCalibrations] = useState<CalWarning[]>([]);
  const [loading, setLoading] = useState(true);
  const [sound, setSound] = useState(false);
  const [filter, setFilter] = useState<"all" | "critical" | "warning">("all");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const prevCriticalRef = useRef<number>(0);

  const auth = { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } };

  const loadStats = useCallback(async () => {
    try {
      const r = await fetch("/api/qms/iqc/andon/stats", auth);
      if (r.ok) setStats(await r.json());
    } catch {}
  }, []);

  const loadAlerts = useCallback(async () => {
    try {
      const r = await fetch("/api/qms/iqc/andon?status=unresolved", auth);
      if (r.ok) {
        const data = await r.json();
        setAlerts(Array.isArray(data) ? data : []);
      }
    } catch { setAlerts([]); }
  }, []);

  const loadTimeouts = useCallback(async () => {
    try {
      const r = await fetch("/api/qms/iqc/andon/timeout-warnings", auth);
      if (r.ok) setTimeouts(Array.isArray(await r.json()) ? await r.json() : []);
    } catch { setTimeouts([]); }
  }, []);

  const loadCalibrations = useCallback(async () => {
    try {
      const r = await fetch("/api/qms/iqc/andon/calibration-warnings", auth);
      if (r.ok) setCalibrations(Array.isArray(await r.json()) ? await r.json() : []);
    } catch { setCalibrations([]); }
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([loadStats(), loadAlerts(), loadTimeouts(), loadCalibrations()]);
    setLoading(false);
  }, [loadStats, loadAlerts, loadTimeouts, loadCalibrations]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Auto-refresh every 30s
  useEffect(() => {
    const id = setInterval(loadAll, 30000);
    return () => clearInterval(id);
  }, [loadAll]);

  // Sound alert on new critical
  useEffect(() => {
    if (!sound || !stats) return;
    const crit = stats.criticalAlerts;
    if (crit > prevCriticalRef.current && crit > 0) {
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
        audioRef.current.play().catch(() => {});
      }
    }
    prevCriticalRef.current = crit;
  }, [stats, sound]);

  const acknowledgeAlert = async (id: number) => {
    try {
      const r = await fetch(`/api/qms/iqc/andon/${id}/acknowledge`, { method: "PUT", ...auth });
      if (r.ok) { await loadAlerts(); await loadStats(); }
    } catch {}
  };

  const resolveAlert = async (id: number) => {
    try {
      const r = await fetch(`/api/qms/iqc/andon/${id}/resolve`, { method: "PUT", ...auth });
      if (r.ok) { await loadAlerts(); await loadStats(); }
    } catch {}
  };

  const filteredAlerts = alerts.filter(a => filter === "all" ? true : a.severity === filter);

  return (
    <div style={{ padding: 24, background: "#0f172a", minHeight: "100vh", color: "#e2e8f0" }}>
      {/* Audio for critical alerts */}
      <audio ref={audioRef} src="data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2teleD4D" />

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Zap size={28} color="#fbbf24" />
          <h2 style={{ color: "#e2e8f0", fontSize: 22, margin: 0 }}>IQC Andon 预警中心</h2>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button onClick={() => setSound(!sound)}
            style={{ padding: "6px 12px", background: sound ? "#16a34a" : "#334155", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
            {sound ? <Bell size={14} /> : <BellOff size={14} />}
            {sound ? "声音开" : "声音关"}
          </button>
          <button onClick={loadAll}
            style={{ padding: "6px 12px", background: "#334155", color: "#e2e8f0", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
            <RefreshCw size={14} /> 刷新
          </button>
        </div>
      </div>

      {/* Stats Strip */}
      {stats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 20 }}>
          {[
            { label: "Critical", value: stats.criticalAlerts, color: "#dc2626", icon: AlertCircle },
            { label: "Warning", value: stats.warningAlerts, color: "#f59e0b", icon: AlertTriangle },
            { label: "超时未检", value: stats.timeoutWarnings, color: "#f97316", icon: Clock },
            { label: "校准到期", value: stats.calibrationDue, color: "#eab308", icon: ShieldCheck },
            { label: "MES锁定", value: stats.mesLocks, color: "#7c3aed", icon: Zap },
          ].map(({ label, value, color, icon: Icon }) => (
            <div key={label} onClick={() => { if (label === "Critical" || label === "Warning") setTab("alerts"); else if (label === "超时未检") setTab("timeout"); else if (label === "校准到期") setTab("calibration"); }}
              style={{ background: "#1e293b", border: `1px solid ${color}`, borderRadius: 10, padding: "14px 16px", cursor: "pointer", textAlign: "center" }}>
              <div style={{ color, fontSize: 32, fontWeight: 800, display: "flex", justifyContent: "center" }}>{value}</div>
              <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 4, display: "flex", justifyContent: "center", alignItems: "center", gap: 4 }}>
                <Icon size={12} /> {label}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tab Navigation */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {(["alerts", "timeout", "calibration"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ padding: "8px 20px", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 14,
              background: tab === t ? "#2563eb" : "#1e293b", color: tab === t ? "#fff" : "#94a3b8",
              borderBottom: tab === t ? "2px solid #2563eb" : "none" }}>
            {t === "alerts" ? `SPC告警 (${alerts.length})` : t === "timeout" ? `超时预警 (${timeouts.length})` : `计量预警 (${calibrations.length})`}
          </button>
        ))}
      </div>

      {/* SPC Alerts */}
      {tab === "alerts" && (
        <div>
          {/* Filter */}
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            {(["all", "critical", "warning"] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)}
                style={{ padding: "4px 14px", border: "1px solid #334155", borderRadius: 6, cursor: "pointer", fontSize: 12,
                  background: filter === f ? "#334155" : "transparent", color: filter === f ? "#e2e8f0" : "#64748b" }}>
                {f === "all" ? "全部" : f === "critical" ? "严重" : "警告"}
              </button>
            ))}
          </div>

          {loading ? (
            <div style={{ color: "#64748b", padding: 40, textAlign: "center" }}>加载中…</div>
          ) : filteredAlerts.length === 0 ? (
            <div style={{ background: "#1e293b", borderRadius: 12, padding: 60, textAlign: "center", color: "#475569" }}>
              <CheckCircle2 size={48} color="#16a34a" style={{ margin: "0 auto 16px", display: "block" }} />
              无进行中的告警
            </div>
          ) : (
            filteredAlerts.map(alert => (
              <AlertRow key={alert.id} alert={alert} onAcknowledge={acknowledgeAlert} onResolve={resolveAlert} />
            ))
          )}
        </div>
      )}

      {/* Timeout Warnings */}
      {tab === "timeout" && (
        <div>
          {timeouts.length === 0 ? (
            <div style={{ background: "#1e293b", borderRadius: 12, padding: 60, textAlign: "center", color: "#475569" }}>
              <Clock size={48} color="#16a34a" style={{ margin: "0 auto 16px", display: "block" }} />
              无超时预警
            </div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {timeouts.map(t => (
                <div key={t.id} style={{ background: "#1e293b", border: "1px solid #f97316", borderRadius: 8, padding: "12px 16px", borderLeft: "4px solid #f97316" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ color: "#e2e8f0", fontWeight: 600, fontSize: 14 }}>{t.lot_no}</div>
                      <div style={{ color: "#64748b", fontSize: 12, marginTop: 2 }}>{t.material_code} | {t.supplier_name || t.supplier_code}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ color: "#f97316", fontSize: 22, fontWeight: 800 }}>
                        {Math.floor(t.hours_pending)}h
                      </div>
                      <div style={{ color: "#475569", fontSize: 11 }}>超时</div>
                    </div>
                  </div>
                  <div style={{ color: "#64748b", fontSize: 12, marginTop: 6 }}>
                    检验员: {t.inspector_name || "-"} | 开始时间: {t.inspection_date ? new Date(t.inspection_date).toLocaleString() : "-"}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Calibration Warnings */}
      {tab === "calibration" && (
        <div>
          {calibrations.length === 0 ? (
            <div style={{ background: "#1e293b", borderRadius: 12, padding: 60, textAlign: "center", color: "#475569" }}>
              <ShieldCheck size={48} color="#16a34a" style={{ margin: "0 auto 16px", display: "block" }} />
              无计量预警
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
              {calibrations.map(c => (
                <div key={c.id} style={{ background: "#1e293b", border: `1px solid ${c.status === "expired" ? "#dc2626" : "#eab308"}`, borderRadius: 8, padding: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ color: "#e2e8f0", fontWeight: 600, fontSize: 14 }}>{c.equipment_name}</div>
                    <span style={{ background: c.status === "expired" ? "#dc2626" : "#eab308", color: "#fff", padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600 }}>
                      {c.status === "expired" ? "已过期" : "即将到期"}
                    </span>
                  </div>
                  <div style={{ color: "#64748b", fontSize: 12, marginTop: 4 }}>编码: {c.equipment_code}</div>
                  <div style={{ color: "#64748b", fontSize: 12 }}>类型: {c.equipment_type}</div>
                  <div style={{ color: c.status === "expired" ? "#dc2626" : "#fbbf24", fontSize: 13, marginTop: 8, fontWeight: 600 }}>
                    到期: {c.next_calibration_date}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* CSS Animation for critical pulse */}
      <style>{`
        @keyframes pulse-red {
          0%, 100% { box-shadow: 0 0 0 0 rgba(220, 38, 38, 0.4); }
          50% { box-shadow: 0 0 0 8px rgba(220, 38, 38, 0); }
        }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .spin { animation: spin 1s linear infinite; }
      `}</style>
    </div>
  );
}
