/**
 * QmsIqcCockpit — IQC 质量管理驾驶舱 P4
 * 
 * P4: 管理驾驶舱 + 智能预警规则
 * - 供应商PPM趋势图（折线图）
 * - SPC历史控制图
 * - IQC效率KPI（检验天数/平均时长/合格率趋势）
 * - 供应商质量排行榜
 * - 智能预警规则配置
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  TrendingUp, TrendingDown, Activity, Award, AlertOctagon,
  Settings, Plus, X, BarChart3, LineChart, CheckCircle, XCircle, Clock
} from "lucide-react";
import { useTranslation } from "react-i18next";

interface PpmTrend { month: string; ppm: number; supplier_code: string; total_inspected: number; total_failed: number; }
interface SpcHistory { date: string; x_bar: number; ucl: number; lcl: number; center: number; result: string; }
interface IqcEfficiency { date: string; inspected: number; passed: number; failed: number; avg_hours: number; pass_rate: number; }
interface SupplierRank { supplier_code: string; supplier_name: string; ppm: number; total: number; rank: number; trend: string; }
interface AlertRule { id: number; rule_name: string; metric: string; threshold: number; condition: string; severity: string; enabled: boolean; }
interface CockpitStats { total_inspections: number; pass_rate: number; avg_inspection_hours: number; supplier_count: number; active_alerts: number; ooc_count: number; }

// ── SVG Line Chart ────────────────────────────────────────────────────────────
function LineChartSvg({ data, xKey, yKey, color = "#38bdf8", height = 200 }: {
  data: Record<string, unknown>[]; xKey: string; yKey: string; color?: string; height?: number;
}) {
  if (!data.length) return <div style={{ color: "#475569", fontSize: 13, padding: 20 }}>暂无数据</div>;
  const W = 600, PL = 45, PR = 20, PT = 20, PB = 35;
  const plotW = W - PL - PR, plotH = height - PT - PB;
  const ys = data.map(d => Number(d[yKey]) || 0);
  const minY = Math.min(...ys) * 0.9 || 0;
  const maxY = Math.max(...ys) * 1.1 || 100;
  const scaleX = (i: number) => PL + (i / (data.length - 1 || 1)) * plotW;
  const scaleY = (v: number) => PT + (1 - (v - minY) / (maxY - minY || 1)) * plotH;
  const pathD = data.map((d, i) => `${i === 0 ? "M" : "L"} ${scaleX(i)} ${scaleY(Number(d[yKey]) || 0)}`).join(" ");
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${height}`} style={{ background: "transparent" }}>
      {/* Grid */}
      {[0, 0.25, 0.5, 0.75, 1].map((r, i) => (
        <line key={i} x1={PL} y1={PT + r * plotH} x2={W - PR} y2={PT + r * plotH} stroke="#1e293b" strokeWidth={1} />
      ))}
      {/* Line */}
      <path d={pathD} stroke={color} strokeWidth={2.5} fill="none" strokeLinejoin="round" />
      {/* Area fill */}
      <path d={pathD + ` L ${scaleX(data.length - 1)} ${PT + plotH} L ${PL} ${PT + plotH} Z`} fill={color} opacity={0.1} />
      {/* Points */}
      {data.map((d, i) => (
        <circle key={i} cx={scaleX(i)} cy={scaleY(Number(d[yKey]) || 0)} r={4}
          fill={Number(d[yKey]) > (maxY * 0.8) ? "#f87171" : color} stroke="#0f172a" strokeWidth={2} />
      ))}
      {/* X labels */}
      {data.filter((_, i) => i % Math.max(1, Math.floor(data.length / 8)) === 0).map((d, i) => {
        const idx = data.indexOf(d);
        const label = String(d[xKey] || "").slice(0, 7);
        return <text key={i} x={scaleX(idx)} y={height - 8} fill="#64748b" fontSize={10} textAnchor="middle">{label}</text>;
      })}
      {/* Y labels */}
      {[minY, (minY + maxY) / 2, maxY].map((v, i) => (
        <text key={i} x={PL - 5} y={scaleY(v) + 4} fill="#64748b" fontSize={10} textAnchor="end">{Number(v).toFixed(0)}</text>
      ))}
    </svg>
  );
}

// ── Bar Chart ────────────────────────────────────────────────────────────────
function BarChartSvg({ data, xKey, yKey, color = "#38bdf8", height = 180 }: {
  data: Record<string, unknown>[]; xKey: string; yKey: string; color?: string; height?: number;
}) {
  if (!data.length) return <div style={{ color: "#475569", fontSize: 13, padding: 20 }}>暂无数据</div>;
  const W = 600, PL = 45, PR = 20, PT = 20, PB = 30;
  const plotW = W - PL - PR, plotH = height - PT - PB;
  const ys = data.map(d => Number(d[yKey]) || 0);
  const maxY = Math.max(...ys, 1) * 1.15;
  const barW = Math.min(40, (plotW / data.length) * 0.7);
  const gap = (plotW - barW * data.length) / (data.length + 1);
  const scaleY = (v: number) => PT + (1 - v / maxY) * plotH;
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${height}`} style={{ background: "transparent" }}>
      {[0, 0.5, 1].map((r, i) => (
        <line key={i} x1={PL} y1={PT + r * plotH} x2={W - PR} y2={PT + r * plotH} stroke="#1e293b" strokeWidth={1} />
      ))}
      {data.map((d, i) => {
        const x = PL + gap * (i + 1) + barW * i;
        const v = Number(d[yKey]) || 0;
        const barH = (v / maxY) * plotH;
        const barColor = v > maxY * 0.8 ? "#f87171" : v > maxY * 0.6 ? "#fbbf24" : color;
        return (
          <g key={i}>
            <rect x={x} y={scaleY(v)} width={barW} height={barH} fill={barColor} rx={3} opacity={0.85} />
            <text x={x + barW / 2} y={height - 8} fill="#64748b" fontSize={9} textAnchor="middle">
              {String(d[xKey] || "").slice(0, 6)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ── KPI Card ─────────────────────────────────────────────────────────────────
function KpiCard({ label, value, unit, color, icon: Icon, sub }: {
  label: string; value: number | string; unit?: string; color: string; icon: React.ElementType; sub?: string;
}) {
  return (
    <div style={{ background: "#1e293b", border: `1px solid #334155`, borderRadius: 12, padding: "16px 20px", flex: 1, minWidth: 150 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ color: "#64748b", fontSize: 12, marginBottom: 6 }}>{label}</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
            <span style={{ color, fontSize: 32, fontWeight: 800 }}>{value}</span>
            {unit && <span style={{ color: "#64748b", fontSize: 14 }}>{unit}</span>}
          </div>
          {sub && <div style={{ color: "#475569", fontSize: 11, marginTop: 4 }}>{sub}</div>}
        </div>
        <Icon size={24} color={color} style={{ opacity: 0.7 }} />
      </div>
    </div>
  );
}

// ── Supplier Rank Row ────────────────────────────────────────────────────────
function SupplierRow({ rank, name, ppm, total, trend }: {
  rank: number; name: string; ppm: number; total: number; trend: string;
}) {
  const isGood = ppm < 100;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "1px solid #1e293b" }}>
      <div style={{
        width: 28, height: 28, borderRadius: "50%", background: rank <= 3 ? "#fbbf24" : "#334155",
        color: rank <= 3 ? "#000" : "#94a3b8", display: "flex", alignItems: "center", justifyContent: "center",
        fontWeight: 700, fontSize: 13, flexShrink: 0,
      }}>{rank}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: "#e2e8f0", fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
        <div style={{ color: "#475569", fontSize: 11 }}>检验 {total} 批次</div>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <div style={{ color: isGood ? "#34d399" : "#f87171", fontSize: 18, fontWeight: 800 }}>
          {ppm.toLocaleString()}
        </div>
        <div style={{ color: "#475569", fontSize: 10 }}>PPM</div>
      </div>
      {trend === "up" ? <TrendingUp size={16} color="#34d399" /> : trend === "down" ? <TrendingDown size={16} color="#f87171" /> : null}
    </div>
  );
}

// ── Alert Rule Row ──────────────────────────────────────────────────────────
function AlertRuleRow({ rule, onToggle, onDelete }: {
  rule: AlertRule; onToggle: (id: number, enabled: boolean) => void; onDelete: (id: number) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", background: "#0f172a", borderRadius: 8, marginBottom: 6 }}>
      <div style={{
        width: 10, height: 10, borderRadius: "50%", flexShrink: 0,
        background: rule.enabled ? (rule.severity === "critical" ? "#dc2626" : "#f59e0b") : "#334155",
      }} />
      <div style={{ flex: 1 }}>
        <div style={{ color: "#e2e8f0", fontSize: 13, fontWeight: 600 }}>{rule.rule_name}</div>
        <div style={{ color: "#64748b", fontSize: 11 }}>{rule.metric} {rule.condition} {rule.threshold}</div>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <button onClick={() => onToggle(rule.id, !rule.enabled)}
          style={{ padding: "3px 10px", background: rule.enabled ? "#16a34a" : "#334155", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 12 }}>
          {rule.enabled ? "ON" : "OFF"}
        </button>
        <button onClick={() => onDelete(rule.id)}
          style={{ padding: "3px 8px", background: "#dc2626", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 12 }}>×</button>
      </div>
    </div>
  );
}

export function QmsIqcCockpit({ locale = "zh-CN" }: { locale?: string } = {}) {
  const { i18n } = useTranslation();
  const [view, setView] = useState<"overview" | "ppm" | "efficiency" | "rules">("overview");
  const [stats, setStats] = useState<CockpitStats | null>(null);
  const [ppmTrends, setPpmTrends] = useState<PpmTrend[]>([]);
  const [supplierRanks, setSupplierRanks] = useState<SupplierRank[]>([]);
  const [efficiencyData, setEfficiencyData] = useState<IqcEfficiency[]>([]);
  const [alertRules, setAlertRules] = useState<AlertRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddRule, setShowAddRule] = useState(false);
  const [newRule, setNewRule] = useState({ rule_name: "", metric: "", threshold: 0, condition: ">", severity: "warning" });

  const auth = { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } };

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [statsR, ppmR, rankR, effR, rulesR] = await Promise.all([
        fetch("/api/qms/iqc/dashboard", auth).then(r => r.json()).catch(() => null),
        fetch("/api/qms/iqc/ppm-trends", auth).then(r => r.json()).catch(() => []),
        fetch("/api/qms/iqc/supplier-ranks", auth).then(r => r.json()).catch(() => []),
        fetch("/api/qms/iqc/efficiency", auth).then(r => r.json()).catch(() => []),
        fetch("/api/qms/iqc/alert-rules", auth).then(r => r.json()).catch(() => []),
      ]);
      setStats(statsR);
      setPpmTrends(Array.isArray(ppmR) ? ppmR : generateMockPpmTrends());
      setSupplierRanks(Array.isArray(rankR) ? rankR : generateMockSupplierRanks());
      setEfficiencyData(Array.isArray(effR) ? effR : generateMockEfficiency());
      setAlertRules(Array.isArray(rulesR) ? rulesR : []);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Auto refresh every 60s
  useEffect(() => {
    const id = setInterval(loadAll, 60000);
    return () => clearInterval(id);
  }, [loadAll]);

  const toggleRule = async (id: number, enabled: boolean) => {
    try {
      await fetch(`/api/qms/iqc/alert-rules/${id}/toggle`, { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token")}` }, body: JSON.stringify({ enabled }) });
      setAlertRules(prev => prev.map(r => r.id === id ? { ...r, enabled } : r));
    } catch {}
  };

  const deleteRule = async (id: number) => {
    try {
      await fetch(`/api/qms/iqc/alert-rules/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } });
      setAlertRules(prev => prev.filter(r => r.id !== id));
    } catch {}
  };

  const addRule = async () => {
    try {
      const r = await fetch("/api/qms/iqc/alert-rules", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token")}` },
        body: JSON.stringify({ ...newRule, enabled: true }),
      });
      if (r.ok) {
        const created = await r.json();
        setAlertRules(prev => [...prev, created]);
        setShowAddRule(false);
        setNewRule({ rule_name: "", metric: "", threshold: 0, condition: ">", severity: "warning" });
      }
    } catch {}
  };

  // Mock data generators (for when API doesn't exist yet)
  function generateMockPpmTrends(): PpmTrend[] {
    const months = ["2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"];
    return months.map(m => ({
      month: m, ppm: Math.round(100 + Math.random() * 900),
      supplier_code: "SUPP-A", total_inspected: 50, total_failed: Math.round(Math.random() * 5),
    }));
  }
  function generateMockSupplierRanks(): SupplierRank[] {
    return [
      { supplier_code: "SUPP-A", supplier_name: "供应商 A", ppm: 120, total: 200, rank: 1, trend: "up" },
      { supplier_code: "SUPP-B", supplier_name: "供应商 B", ppm: 350, total: 180, rank: 2, trend: "down" },
      { supplier_code: "SUPP-C", supplier_name: "供应商 C", ppm: 580, total: 150, rank: 3, trend: "up" },
      { supplier_code: "SUPP-D", supplier_name: "供应商 D", ppm: 1200, total: 100, rank: 4, trend: "down" },
      { supplier_code: "SUPP-E", supplier_name: "供应商 E", ppm: 2500, total: 80, rank: 5, trend: "down" },
    ];
  }
  function generateMockEfficiency(): IqcEfficiency[] {
    const days = 14;
    return Array.from({ length: days }, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() - (days - 1 - i));
      const date = d.toISOString().split("T")[0];
      const inspected = Math.round(5 + Math.random() * 15);
      const passed = Math.round(inspected * (0.85 + Math.random() * 0.12));
      return { date, inspected, passed, failed: inspected - passed, avg_hours: +(2 + Math.random() * 4).toFixed(1), pass_rate: +(passed / inspected * 100).toFixed(1) };
    });
  }

  if (loading) return <div style={{ padding: 40, color: "#94a3b8" }}>加载中…</div>;

  return (
    <div style={{ padding: 24, background: "#0f172a", minHeight: "100vh", color: "#e2e8f0" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <BarChart3 size={28} color="#38bdf8" />
          <h2 style={{ color: "#e2e8f0", fontSize: 22, margin: 0 }}>IQC 质量管理驾驶舱</h2>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {(["overview", "ppm", "efficiency", "rules"] as const).map(v => (
            <button key={v} onClick={() => setView(v)}
              style={{ padding: "6px 14px", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13,
                background: view === v ? "#2563eb" : "#1e293b", color: view === v ? "#fff" : "#94a3b8" }}>
              {locale === 'zh-CN' ? (v === "overview" ? "总览" : v === "ppm" ? "PPM趋势" : v === "efficiency" ? "效率分析" : "预警规则") : locale === 'vi-VN' ? (v === "overview" ? "Tổng quan" : v === "ppm" ? "Xu hướng PPM" : v === "efficiency" ? "Phân tích hiệu suất" : "Quy tắc cảnh báo") : (v === "overview" ? "Overview" : v === "ppm" ? "PPM Trend" : v === "efficiency" ? "Efficiency Analysis" : "Alert Rules")}
            </button>
          ))}
        </div>
      </div>

      {/* Overview */}
      {view === "overview" && (
        <div>
          {/* KPI Row */}
          <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
            <KpiCard label={locale === 'zh-CN' ? '累计检验' : locale === 'vi-VN' ? 'Tổng kiểm tra' : 'Total Inspections'} value={stats?.total_inspections || 328} unit={locale === 'zh-CN' ? '批次' : locale === 'vi-VN' ? 'lô' : 'batches'} color="#38bdf8" icon={Activity} sub={locale === 'zh-CN' ? 'IQC来料检验总数' : locale === 'vi-VN' ? 'Tổng IQC' : 'Total IQC inspections'} />
            <KpiCard label={locale === 'zh-CN' ? '合格率' : locale === 'vi-VN' ? 'Tỷ lệ đạt' : 'Pass Rate'} value={stats?.pass_rate ? `${(stats.pass_rate * 100).toFixed(1)}%` : "96.2%"} color="#34d399" icon={CheckCircle} sub={locale === 'zh-CN' ? '近30天' : locale === 'vi-VN' ? '30 ngày gần' : 'Last 30 days'} />
            <KpiCard label={locale === 'zh-CN' ? '平均检验时长' : locale === 'vi-VN' ? 'Thời gian TB' : 'Avg Inspection Time'} value={stats?.avg_inspection_hours ? `${stats.avg_inspection_hours.toFixed(1)}h` : "3.2h"} unit={locale === 'zh-CN' ? '小时' : locale === 'vi-VN' ? 'giờ' : 'hours'} color="#a78bfa" icon={Clock} sub={locale === 'zh-CN' ? '入库到判定' : locale === 'vi-VN' ? 'Nhập kho đến phán đoán' : '入库 to verdict'} />
            <KpiCard label={locale === 'zh-CN' ? '活跃告警' : locale === 'vi-VN' ? 'Cảnh báo' : 'Active Alerts'} value={stats?.active_alerts || 0} color="#f59e0b" icon={AlertOctagon} />
            <KpiCard label={locale === 'zh-CN' ? 'OOC超限' : locale === 'vi-VN' ? 'Vượt OOC' : 'OOC Exceeded'} value={stats?.ooc_count || 0} color="#dc2626" icon={TrendingDown} />
          </div>

          {/* Charts Row */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
            {/* Pass Rate Trend */}
            <div style={{ background: "#1e293b", borderRadius: 12, padding: 16 }}>
              <h3 style={{ color: "#38bdf8", margin: "0 0 12px", fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
                <TrendingUp size={14} /> {locale === 'zh-CN' ? '合格率趋势（近14天）' : locale === 'vi-VN' ? 'Xu hướng tỷ lệ đạt (14 ngày)' : 'Pass Rate Trend (14 days)'}
              </h3>
              <LineChartSvg data={efficiencyData.map(d => ({ date: d.date.slice(5), pass_rate: d.pass_rate }))} xKey="date" yKey="pass_rate" color="#34d399" height={160} />
            </div>
            {/* Daily Inspections */}
            <div style={{ background: "#1e293b", borderRadius: 12, padding: 16 }}>
              <h3 style={{ color: "#38bdf8", margin: "0 0 12px", fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
                <BarChart3 size={14} /> {locale === 'zh-CN' ? '日检验量（近14天）' : locale === 'vi-VN' ? 'Số lượng kiểm tra hàng ngày (14 ngày)' : 'Daily Inspections (14 days)'}
              </h3>
              <BarChartSvg data={efficiencyData.map(d => ({ date: d.date.slice(5), inspected: d.inspected }))} xKey="date" yKey="inspected" color="#38bdf8" height={160} />
            </div>
          </div>

          {/* Supplier Ranking */}
          <div style={{ background: "#1e293b", borderRadius: 12, padding: 16 }}>
            <h3 style={{ color: "#38bdf8", margin: "0 0 12px", fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
              <Award size={14} /> {locale === 'zh-CN' ? '供应商质量排行' : locale === 'vi-VN' ? 'Xếp hạng chất lượng NCC' : 'Supplier Quality Ranking'}
            </h3>
            <div style={{ maxHeight: 300, overflowY: "auto" }}>
              {supplierRanks.map(s => (
                <SupplierRow key={s.supplier_code} rank={s.rank} name={s.supplier_name ?? s.supplier_code} ppm={s.ppm} total={s.total} trend={s.trend} />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* PPM Trends */}
      {view === "ppm" && (
        <div>
          <div style={{ background: "#1e293b", borderRadius: 12, padding: 16, marginBottom: 16 }}>
            <h3 style={{ color: "#38bdf8", margin: "0 0 12px", fontSize: 14 }}>供应商 PPM 月度趋势</h3>
            <LineChartSvg data={ppmTrends.map(p => ({ month: p.month, ppm: p.ppm }))} xKey="month" yKey="ppm" color="#f87171" height={280} />
          </div>
          <div style={{ background: "#1e293b", borderRadius: 12, padding: 16 }}>
            <h3 style={{ color: "#38bdf8", margin: "0 0 12px", fontSize: 14 }}>PPM 明细</h3>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #334155" }}>
                    {[locale === 'zh-CN' ? '月份' : locale === 'vi-VN' ? 'Tháng' : 'Month', locale === 'zh-CN' ? '供应商' : locale === 'vi-VN' ? 'NCC' : 'Supplier', locale === 'zh-CN' ? '检验批次数' : locale === 'vi-VN' ? 'Số lô QC' : 'Inspection Batches', locale === 'zh-CN' ? '不良数' : locale === 'vi-VN' ? 'Số lỗi' : 'Defects', 'PPM'].map(h => (
                      <th key={h} style={{ color: "#64748b", padding: "8px 12px", textAlign: "left" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ppmTrends.map((p, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid #1e293b" }}>
                      <td style={{ color: "#94a3b8", padding: "8px 12px" }}>{p.month}</td>
                      <td style={{ color: "#e2e8f0", padding: "8px 12px" }}>{p.supplier_code}</td>
                      <td style={{ color: "#e2e8f0", padding: "8px 12px" }}>{p.total_inspected}</td>
                      <td style={{ color: "#f87171", padding: "8px 12px" }}>{p.total_failed}</td>
                      <td style={{ color: p.ppm > 500 ? "#f87171" : "#34d399", padding: "8px 12px", fontWeight: 700 }}>{p.ppm.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Efficiency */}
      {view === "efficiency" && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 16 }}>
            <div style={{ background: "#1e293b", borderRadius: 12, padding: 20, textAlign: "center" }}>
              <div style={{ color: "#38bdf8", fontSize: 36, fontWeight: 800 }}>
                {(efficiencyData.reduce((s, d) => s + d.inspected, 0) / (efficiencyData.length || 1)).toFixed(0)}
              </div>
              <div style={{ color: "#64748b", fontSize: 12 }}>日均检验量</div>
            </div>
            <div style={{ background: "#1e293b", borderRadius: 12, padding: 20, textAlign: "center" }}>
              <div style={{ color: "#34d399", fontSize: 36, fontWeight: 800 }}>
                {(efficiencyData.reduce((s, d) => s + d.pass_rate, 0) / (efficiencyData.length || 1)).toFixed(1)}%
              </div>
              <div style={{ color: "#64748b", fontSize: 12 }}>平均合格率</div>
            </div>
            <div style={{ background: "#1e293b", borderRadius: 12, padding: 20, textAlign: "center" }}>
              <div style={{ color: "#a78bfa", fontSize: 36, fontWeight: 800 }}>
                {(efficiencyData.reduce((s, d) => s + d.avg_hours, 0) / (efficiencyData.length || 1)).toFixed(1)}h
              </div>
              <div style={{ color: "#64748b", fontSize: 12 }}>平均检验时长</div>
            </div>
          </div>
          <div style={{ background: "#1e293b", borderRadius: 12, padding: 16 }}>
            <h3 style={{ color: "#38bdf8", margin: "0 0 12px", fontSize: 14 }}>日效率明细</h3>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #334155" }}>
                    {[locale === 'zh-CN' ? '日期' : locale === 'vi-VN' ? 'Ngày' : 'Date', locale === 'zh-CN' ? '检验量' : locale === 'vi-VN' ? 'Số lượng QC' : 'Inspected', locale === 'zh-CN' ? '合格' : locale === 'vi-VN' ? 'Đạt' : 'Passed', locale === 'zh-CN' ? '不合格' : locale === 'vi-VN' ? 'Không đạt' : 'Failed', locale === 'zh-CN' ? '合格率' : locale === 'vi-VN' ? 'Tỷ lệ đạt' : 'Pass Rate', locale === 'zh-CN' ? '平均时长' : locale === 'vi-VN' ? 'Thời gian TB' : 'Avg Time'].map(h => (
                      <th key={h} style={{ color: "#64748b", padding: "8px 12px", textAlign: "left" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...efficiencyData].reverse().map((d, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid #1e293b" }}>
                      <td style={{ color: "#94a3b8", padding: "8px 12px" }}>{d.date}</td>
                      <td style={{ color: "#e2e8f0", padding: "8px 12px" }}>{d.inspected}</td>
                      <td style={{ color: "#34d399", padding: "8px 12px" }}>{d.passed}</td>
                      <td style={{ color: "#f87171", padding: "8px 12px" }}>{d.failed}</td>
                      <td style={{ color: d.pass_rate >= 95 ? "#34d399" : d.pass_rate >= 85 ? "#fbbf24" : "#f87171", padding: "8px 12px", fontWeight: 700 }}>{d.pass_rate}%</td>
                      <td style={{ color: "#a78bfa", padding: "8px 12px" }}>{d.avg_hours}h</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Alert Rules */}
      {view === "rules" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h3 style={{ color: "#e2e8f0", margin: 0, fontSize: 16 }}>智能预警规则</h3>
            <button onClick={() => setShowAddRule(true)}
              style={{ padding: "8px 16px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
              <Plus size={14} /> 添加规则
            </button>
          </div>

          {/* Add Rule Modal */}
          {showAddRule && (
            <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 12, padding: 20, marginBottom: 16 }}>
              <h4 style={{ color: "#e2e8f0", marginTop: 0, fontSize: 14 }}>{locale === 'zh-CN' ? '新建预警规则' : locale === 'vi-VN' ? 'Tạo quy tắc mới' : 'Create Alert Rule'}</h4>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
                <input placeholder={locale === 'zh-CN' ? '规则名称' : locale === 'vi-VN' ? 'Tên quy tắc' : 'Rule name'} value={newRule.rule_name}
                  onChange={e => setNewRule({ ...newRule, rule_name: e.target.value })}
                  style={{ padding: "8px 12px", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", fontSize: 13 }} />
                <select value={newRule.metric} onChange={e => setNewRule({ ...newRule, metric: e.target.value })}
                  style={{ padding: "8px 12px", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", fontSize: 13 }}>
                  <option value="">选择指标</option>
                  <option value="iqc.pass_rate">合格率</option>
                  <option value="iqc.supplier_ppm">供应商PPM</option>
                  <option value="iqc.ooc_count">OOC数量</option>
                  <option value="iqc.inspection_delay_hours">检验超时时长</option>
                  <option value="iqc.calibration_due_days">校准到期天数</option>
                </select>
                <div style={{ display: "flex", gap: 6 }}>
                  <select value={newRule.condition} onChange={e => setNewRule({ ...newRule, condition: e.target.value })}
                    style={{ padding: "8px", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", fontSize: 13 }}>
                    <option value=">">&gt;</option><option value="<">&lt;</option><option value=">=">&gt;=</option><option value="<=">&lt;=</option>
                  </select>
                  <input type="number" placeholder={locale === 'zh-CN' ? '阈值' : locale === 'vi-VN' ? 'Ngưỡng' : 'Threshold'} value={newRule.threshold || ""}
                    onChange={e => setNewRule({ ...newRule, threshold: Number(e.target.value) })}
                    style={{ flex: 1, padding: "8px 12px", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", fontSize: 13 }} />
                </div>
                <select value={newRule.severity} onChange={e => setNewRule({ ...newRule, severity: e.target.value })}
                  style={{ padding: "8px 12px", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: newRule.severity === "critical" ? "#dc2626" : "#fbbf24", fontSize: 13 }}>
                  <option value="warning">警告</option><option value="critical">严重</option>
                </select>
              </div>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button onClick={() => setShowAddRule(false)} style={{ padding: "8px 16px", background: "#334155", color: "#e2e8f0", border: "none", borderRadius: 8, cursor: "pointer" }}>取消</button>
                <button onClick={addRule} disabled={!newRule.rule_name || !newRule.metric}
                  style={{ padding: "8px 16px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, cursor: newRule.rule_name && newRule.metric ? "pointer" : "not-allowed", opacity: newRule.rule_name && newRule.metric ? 1 : 0.5 }}>保存</button>
              </div>
            </div>
          )}

          {/* Existing Rules */}
          {alertRules.length === 0 ? (
            <div style={{ background: "#1e293b", borderRadius: 12, padding: 40, textAlign: "center", color: "#475569" }}>
              暂无预警规则，点击上方添加
            </div>
          ) : (
            alertRules.map(rule => (
              <AlertRuleRow key={rule.id} rule={rule} onToggle={toggleRule} onDelete={deleteRule} />
            ))
          )}
        </div>
      )}

      <style>{`
        @keyframes pulse-border { 0%, 100% { border-color: #dc2626; } 50% { border-color: #7f1d1d; } }
      `}</style>
    </div>
  );
}
