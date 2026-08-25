import { useState, useEffect, useRef } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { maintenanceApi } from "../api";
import type { EquipmentAsset, WorkOrder } from "../api/maintenance";

interface Props { locale: Locale; }

const STATUS_CONFIG: Record<string, { color: string; glow: string; label: string; pulse?: boolean }> = {
  active:  { color: "#22c55e", glow: "0 0 12px #22c55e88", label: "运行" },
  online:  { color: "#22c55e", glow: "0 0 12px #22c55e88", label: "运行" },
  idle:    { color: "#3b82f6", glow: "0 0 12px #3b82f688", label: "待机" },
  maintenance: { color: "#f59e0b", glow: "0 0 12px #f59e0b88", label: "保养", pulse: true },
  repair:  { color: "#ef4444", glow: "0 0 16px #ef444488", label: "维修", pulse: true },
  fault:   { color: "#ef4444", glow: "0 0 16px #ef444488", label: "故障", pulse: true },
  offline: { color: "#6b7280", glow: "none", label: "停机" },
  scrapped:{ color: "#374151", glow: "none", label: "报废" },
};

const CRIT_BORDER: Record<string, string> = { A: "#ef4444", B: "#f59e0b", C: "#22c55e" };

function StatusLight({ status, size = 14 }: { status: string; size?: number }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.offline;
  return (
    <span style={{
      display: "inline-block", width: size, height: size, borderRadius: "50%",
      background: cfg.color, boxShadow: cfg.glow,
      animation: cfg.pulse ? "andon-pulse 1.5s ease-in-out infinite" : "none",
    }} />
  );
}

export function EquipmentAndonBoard({ locale }: Props) {
  const [assets, setAssets] = useState<EquipmentAsset[]>([]);
  const [openWOs, setOpenWOs] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(new Date());
  const [lineFilter, setLineFilter] = useState("all");
  const intervalRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    const fetch = () => {
      maintenanceApi.getAssets({ limit: 200 }).then((r: any) => {
        setAssets(r?.data ?? []);
        setLoading(false);
      }).catch(() => setLoading(false));
      maintenanceApi.getWorkOrders({ limit: 20 }).then((r: any) => {
        const d = r?.data ?? [];
        setOpenWOs(d.filter((w: WorkOrder) => !["fixed", "closed", "completed"].includes(w.status)));
      }).catch(() => {});
    };
    fetch();
    intervalRef.current = setInterval(fetch, 30000); // refresh every 30s
    return () => clearInterval(intervalRef.current);
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const lines = [...new Set(assets.map(a => a.line_code).filter(Boolean))] as string[];
  const filtered = lineFilter === "all" ? assets : assets.filter(a => a.line_code === lineFilter);

  // Group by line
  const byLine: Record<string, EquipmentAsset[]> = {};
  for (const a of filtered) {
    const key = a.line_code ?? "未分配";
    if (!byLine[key]) byLine[key] = [];
    byLine[key].push(a);
  }

  const counts = {
    total: assets.length,
    running: assets.filter(a => ["active", "online"].includes(a.status)).length,
    fault: assets.filter(a => ["fault", "repair"].includes(a.status)).length,
    maintenance: assets.filter(a => a.status === "maintenance").length,
    idle: assets.filter(a => a.status === "idle").length,
    offline: assets.filter(a => ["offline", "scrapped"].includes(a.status)).length,
  };
  const utilization = counts.total ? Math.round((counts.running / counts.total) * 100) : 0;

  return (
    <div style={{ background: "#0a0e17", minHeight: "100vh", color: "#e2e8f0", fontFamily: "'Segoe UI', system-ui, sans-serif" }}>
      <style>{`
        @keyframes andon-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(0.85); }
        }
        @keyframes andon-slide { from { transform: translateX(100%); } to { transform: translateX(-100%); } }
        @keyframes andon-fadein { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 24px", borderBottom: "1px solid #1e293b" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: 1 }}>
            🏭 设备状态 ANDON
          </h1>
          <span style={{ fontSize: 12, color: "#64748b" }}>EQUIPMENT STATUS BOARD</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          {/* Line filter */}
          <div style={{ display: "flex", gap: 4 }}>
            <button onClick={() => setLineFilter("all")} style={{
              padding: "3px 10px", borderRadius: 4, border: "none", cursor: "pointer", fontSize: 11,
              background: lineFilter === "all" ? "#3b82f6" : "#1e293b", color: lineFilter === "all" ? "#fff" : "#94a3b8",
            }}>全部</button>
            {lines.map(l => (
              <button key={l} onClick={() => setLineFilter(l)} style={{
                padding: "3px 10px", borderRadius: 4, border: "none", cursor: "pointer", fontSize: 11,
                background: lineFilter === l ? "#3b82f6" : "#1e293b", color: lineFilter === l ? "#fff" : "#94a3b8",
              }}>{l}</button>
            ))}
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, fontFamily: "monospace", color: "#3b82f6" }}>
            {now.toLocaleTimeString("zh-CN", { hour12: false })}
          </div>
          <div style={{ fontSize: 12, color: "#64748b" }}>
            {now.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" })}
          </div>
        </div>
      </div>

      {/* KPI Strip */}
      <div style={{ display: "flex", gap: 2, padding: "8px 24px", background: "#0f172a" }}>
        {[
          { label: "设备总数", value: counts.total, color: "#e2e8f0" },
          { label: "运行中", value: counts.running, color: "#22c55e" },
          { label: "故障/维修", value: counts.fault, color: "#ef4444" },
          { label: "保养中", value: counts.maintenance, color: "#f59e0b" },
          { label: "待机", value: counts.idle, color: "#3b82f6" },
          { label: "停机", value: counts.offline, color: "#6b7280" },
          { label: "利用率", value: `${utilization}%`, color: utilization >= 80 ? "#22c55e" : utilization >= 60 ? "#f59e0b" : "#ef4444" },
          { label: "开放工单", value: openWOs.length, color: openWOs.length > 0 ? "#f59e0b" : "#22c55e" },
        ].map((kpi, i) => (
          <div key={i} style={{ flex: 1, textAlign: "center", padding: "6px 0" }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: kpi.color, lineHeight: 1.2 }}>{kpi.value}</div>
            <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>{kpi.label}</div>
          </div>
        ))}
      </div>

      {/* Alert Ticker */}
      {openWOs.length > 0 && (
        <div style={{ overflow: "hidden", background: "#1c1917", borderBottom: "1px solid #292524", padding: "4px 0" }}>
          <div style={{ display: "flex", animation: "andon-slide 20s linear infinite", whiteSpace: "nowrap" }}>
            {openWOs.map(wo => (
              <span key={wo.id} style={{ fontSize: 12, color: "#fbbf24", marginRight: 48 }}>
                ⚠️ {wo.wo_no} | {wo.equipment_name ?? wo.equipment_code} | {wo.fault_description?.slice(0, 40)} | {wo.urgency_level === "line_down" ? "🔴停线" : "🟡处理中"}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Equipment Grid by Line */}
      <div style={{ padding: "12px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
        {loading ? (
          <div style={{ textAlign: "center", padding: 48, color: "#64748b" }}>加载中...</div>
        ) : (
          Object.entries(byLine).map(([line, equips]) => (
            <div key={line} style={{ animation: "andon-fadein 0.3s ease" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: "#94a3b8" }}>📍 {line}</span>
                <span style={{ fontSize: 11, color: "#475569" }}>{equips.length}台</span>
                <div style={{ flex: 1, height: 1, background: "#1e293b" }} />
                <span style={{ fontSize: 11, color: "#475569" }}>
                  运行 {equips.filter(e => ["active", "online"].includes(e.status)).length} / {equips.length}
                </span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 8 }}>
                {equips.map(eq => {
                  const cfg = STATUS_CONFIG[eq.status] ?? STATUS_CONFIG.offline;
                  return (
                    <div key={eq.id} style={{
                      background: "#111827", borderRadius: 8, padding: "10px 12px",
                      borderLeft: `3px solid ${CRIT_BORDER[eq.criticality] ?? "#374151"}`,
                      border: `1px solid ${eq.status === "fault" || eq.status === "repair" ? "#ef444444" : "#1e293b"}`,
                      transition: "all 0.3s ease",
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                        <span style={{ fontSize: 10, fontFamily: "monospace", color: "#64748b" }}>{eq.asset_code}</span>
                        <StatusLight status={eq.status} />
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {eq.name_zh}
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: 10, color: cfg.color, fontWeight: 600 }}>{cfg.label}</span>
                        <span style={{ fontSize: 10, color: "#475569" }}>{eq.category_zh ?? ""}</span>
                      </div>
                      {eq.cumulative_runtime_hours != null && (
                        <div style={{ fontSize: 9, color: "#374151", marginTop: 2 }}>
                          {Number(eq.cumulative_runtime_hours).toLocaleString()}h | 维修{eq.total_repair_count ?? 0}次
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, display: "flex", justifyContent: "space-between", padding: "6px 24px", background: "#0f172a", borderTop: "1px solid #1e293b", fontSize: 10, color: "#475569" }}>
        <span>越南瑞晶SMT工厂 · 设备管理Andon</span>
        <span>自动刷新: 30s | {now.toLocaleTimeString("zh-CN", { hour12: false })}</span>
      </div>
    </div>
  );
}
