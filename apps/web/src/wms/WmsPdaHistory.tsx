import { useState, useEffect, useCallback, useMemo } from "react";
import { Search, BarChart3, PieChart, TrendingUp, RotateCcw } from "lucide-react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { wmsApi } from "../api";
import type { PdaInspectionRecord } from "../api";

function PieChartSvg({ data, size = 160 }: { data: { label: string; value: number; color: string }[]; size?: number }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return <div style={{ color: "#6b7280", textAlign: "center", padding: 20 }}>—</div>;
  let cumulative = 0;
  const slices = data.map(d => {
    const start = (cumulative / total) * 360;
    cumulative += d.value;
    const end = (cumulative / total) * 360;
    return { ...d, start, end };
  });
  const cx = size / 2, cy = size / 2, r = size / 2 - 8;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {slices.map((d, i) => {
        const sRad = (d.start - 90) * Math.PI / 180;
        const eRad = (d.end - 90) * Math.PI / 180;
        const x1 = cx + r * Math.cos(sRad);
        const y1 = cy + r * Math.sin(sRad);
        const x2 = cx + r * Math.cos(eRad);
        const y2 = cy + r * Math.sin(eRad);
        const large = d.end - d.start > 180 ? 1 : 0;
        return <path key={i} d={`M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`} fill={d.color} stroke="#111827" strokeWidth={1} />;
      })}
      <circle cx={cx} cy={cy} r={r * 0.45} fill="#1f2937" />
    </svg>
  );
}

function BarChartSvg({ data, height = 160 }: { data: { label: string; value: number; color: string }[]; height?: number }) {
  const max = Math.max(...data.map(d => d.value), 1);
  const w = Math.max(300, data.length * 50);
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="xMidYMid meet">
      {data.map((d, i) => {
        const barH = (d.value / max) * (height - 30);
        const bw = Math.max(20, w / data.length - 8);
        const x = i * (bw + 8) + 8;
        const y = height - 10 - barH;
        return (
          <g key={i}>
            <rect x={x} y={y} width={bw} height={barH} rx={3} fill={d.color} opacity={0.85} />
            <text x={x + bw / 2} y={height - 2} textAnchor="middle" fill="#9ca3af" fontSize={9}>{d.label}</text>
            <text x={x + bw / 2} y={y - 4} textAnchor="middle" fill="white" fontSize={10} fontWeight={700}>{d.value}</text>
          </g>
        );
      })}
    </svg>
  );
}

function TrendChartSvg({ data, height = 140, locale }: { data: { date: string; pass: number; fail: number }[]; height?: number; locale: Locale }) {
  if (data.length < 2) return <div style={{ color: "#6b7280", textAlign: "center", padding: 20 }}>{t("pdaHistory.insufficientData", locale)}</div>;
  const w = Math.max(300, data.length * 50);
  const max = Math.max(...data.flatMap(d => [d.pass, d.fail]), 1);
  const toX = (i: number) => (i / (data.length - 1)) * (w - 20) + 10;
  const toY = (v: number) => height - 20 - (v / max) * (height - 40);
  const passLine = data.map((d, i) => `${i === 0 ? "M" : "L"} ${toX(i).toFixed(0)} ${toY(d.pass).toFixed(0)}`).join(" ");
  const failLine = data.map((d, i) => `${i === 0 ? "M" : "L"} ${toX(i).toFixed(0)} ${toY(d.fail).toFixed(0)}`).join(" ");
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="xMidYMid meet">
      <path d={passLine} fill="none" stroke="#22c55e" strokeWidth={2} />
      <path d={failLine} fill="none" stroke="#ef4444" strokeWidth={2} strokeDasharray="4 2" />
      {data.map((d, i) => (
        <g key={i}>
          <circle cx={toX(i)} cy={toY(d.pass)} r={3} fill="#22c55e" />
          <circle cx={toX(i)} cy={toY(d.fail)} r={3} fill="#ef4444" />
        </g>
      ))}
      <text x={w - 60} y={12} fill="#22c55e" fontSize={10} fontWeight={700}>{t("pdaHistory.pass", locale)}</text>
      <text x={w - 60} y={24} fill="#ef4444" fontSize={10} fontWeight={700}>{t("pdaHistory.fail", locale)}</text>
    </svg>
  );
}

function DecisionBadge({ decision }: { decision: string }) {
  const colors: Record<string, string> = { PASS: "#22c55e", HOLD: "#f59e0b", REJECT: "#ef4444", RECEIVED: "#3b82f6" };
  return <span style={{ background: (colors[decision] || "#6b7280") + "22", color: colors[decision] || "#6b7280", padding: "2px 8px", borderRadius: 4, fontSize: 12, fontWeight: 700 }}>{decision}</span>;
}

const DEFECT_COLORS: Record<string, string> = {
  BENT_LEAD: "#f59e0b", MISSING_COMP: "#ef4444", TOMBSTONE: "#ec4899",
  BRIDGE: "#8b5cf6", COLD_SOLDER: "#14b8a6", CRACK: "#f97316",
  OXIDATION: "#06b6d4", CONTAMINATION: "#84cc16", OTHER: "#6b7280",
};

export function WmsPdaHistory({ locale }: { locale: Locale }) {
  const [records, setRecords] = useState<PdaInspectionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<"ALL" | "RECEIVING" | "IQC">("ALL");
  const [filterDecision, setFilterDecision] = useState<string>("ALL");
  const [searchLot, setSearchLot] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const loadRecords = useCallback(async () => {
    setLoading(true);
    const res = await wmsApi.getPdaInspectionRecords({ limit: 500 }).catch(() => ({ items: [], total: 0 }));
    setRecords(res.items);
    setLoading(false);
  }, []);

  useEffect(() => { loadRecords(); }, [loadRecords]);

  const filtered = useMemo(() => {
    let items = [...records];
    if (filterType !== "ALL") items = items.filter(r => r.record_type === filterType);
    if (filterDecision !== "ALL") items = items.filter(r => r.decision === filterDecision);
    if (searchLot.trim()) {
      const q = searchLot.trim().toLowerCase();
      items = items.filter(r => r.lot_no?.toLowerCase().includes(q) || r.material_code?.toLowerCase().includes(q) || r.supplier_code?.toLowerCase().includes(q));
    }
    return items.sort((a, b) => new Date(b.recorded_at || 0).getTime() - new Date(a.recorded_at || 0).getTime());
  }, [records, filterType, filterDecision, searchLot]);

  const stats = useMemo(() => {
    const total = filtered.length;
    const iqcRecords = filtered.filter(r => r.record_type === "IQC");
    const passCount = iqcRecords.filter(r => r.decision === "PASS").length;
    const holdCount = iqcRecords.filter(r => r.decision === "HOLD").length;
    const rejectCount = iqcRecords.filter(r => r.decision === "REJECT").length;
    const recvCount = filtered.filter(r => r.record_type === "RECEIVING").length;
    const defectTypeCounts: Record<string, number> = {};
    iqcRecords.forEach(r => { if (r.defect_type) defectTypeCounts[r.defect_type] = (defectTypeCounts[r.defect_type] || 0) + 1; });
    return { total, iqc: iqcRecords.length, passCount, holdCount, rejectCount, recvCount, defectTypeCounts };
  }, [filtered]);

  const trendData = useMemo(() => {
    const byDate: Record<string, { pass: number; fail: number }> = {};
    filtered.filter(r => r.record_type === "IQC").forEach(r => {
      const d = (r.recorded_at || "").slice(0, 10);
      if (!byDate[d]) byDate[d] = { pass: 0, fail: 0 };
      if (r.decision === "PASS") byDate[d].pass++;
      else byDate[d].fail++;
    });
    return Object.entries(byDate).sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ date, ...v }));
  }, [filtered]);

  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16, height: "100%", overflow: "auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h2 style={{ margin: 0, color: "white", fontSize: 18, display: "flex", alignItems: "center", gap: 8 }}>
          <BarChart3 size={20} />{t("wms.subnav.pdaHistory", locale)}
        </h2>
        <button onClick={loadRecords} style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid #374151", background: "transparent", color: "#9ca3af", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <RotateCcw size={14} />{t("button.refresh", locale)}
        </button>
      </div>

      {loading && <div style={{ textAlign: "center", padding: 40, color: "#6b7280" }}>{t("common.loading", locale)}</div>}

      {!loading && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10 }}>
            {[
              { key: "pdaHistory.totalInspections", value: stats.total, color: "#3b82f6" },
              { key: "pdaHistory.passRate", value: stats.iqc > 0 ? `${(stats.passCount / stats.iqc * 100).toFixed(1)}%` : "—", color: "#22c55e" },
              { key: "pdaHistory.holdRate", value: stats.iqc > 0 ? `${(stats.holdCount / stats.iqc * 100).toFixed(1)}%` : "—", color: "#f59e0b" },
              { key: "pdaHistory.rejectRate", value: stats.iqc > 0 ? `${(stats.rejectCount / stats.iqc * 100).toFixed(1)}%` : "—", color: "#ef4444" },
              { key: "pdaHistory.receivingCount", value: stats.recvCount, color: "#8b5cf6" },
            ].map(s => (
              <div key={s.key} style={{ background: "#1f2937", borderRadius: 10, padding: "12px 14px" }}>
                <div style={{ color: "#6b7280", fontSize: 11, textTransform: "uppercase" }}>{t(s.key, locale)}</div>
                <div style={{ color: s.color, fontSize: 24, fontWeight: 800 }}>{s.value}</div>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#1f2937", borderRadius: 6, padding: "6px 10px" }}>
              <Search size={14} color="#6b7280" />
              <input value={searchLot} onChange={e => setSearchLot(e.target.value)} placeholder={t("pdaHistory.searchPlaceholder", locale)} style={{ background: "transparent", border: "none", color: "white", fontSize: 13, outline: "none", width: 180 }} />
            </div>
            <select value={filterType} onChange={e => setFilterType(e.target.value as typeof filterType)} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #374151", background: "#1f2937", color: "white", fontSize: 13 }}>
              <option value="ALL">{t("pdaHistory.allTypes", locale)}</option>
              <option value="RECEIVING" key="RECEIVING">{t("pda.receiving", locale)}</option>
              <option value="IQC" key="IQC">{t("pda.iqcInspection", locale)}</option>
            </select>
            <select value={filterDecision} onChange={e => setFilterDecision(e.target.value)} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #374151", background: "#1f2937", color: "white", fontSize: 13 }}>
              <option value="ALL">{t("pdaHistory.allDecisions", locale)}</option>
              <option value="PASS" key="PASS">PASS</option>
              <option value="HOLD" key="HOLD">HOLD</option>
              <option value="REJECT" key="REJECT">REJECT</option>
              <option value="RECEIVED" key="RECEIVED">RECEIVED</option>
            </select>
          </div>

          {filtered.length > 0 && stats.iqc > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
              <div style={{ background: "#1f2937", borderRadius: 10, padding: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, color: "#9ca3af", fontSize: 12, textTransform: "uppercase" }}>
                  <PieChart size={14} />{t("pdaHistory.decisionDistribution", locale)}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                  <PieChartSvg data={[
                    { label: "PASS", value: stats.passCount, color: "#22c55e" },
                    { label: "HOLD", value: stats.holdCount, color: "#f59e0b" },
                    { label: "REJECT", value: stats.rejectCount, color: "#ef4444" },
                  ]} />
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {[
                      { label: "PASS", value: stats.passCount, color: "#22c55e" },
                      { label: "HOLD", value: stats.holdCount, color: "#f59e0b" },
                      { label: "REJECT", value: stats.rejectCount, color: "#ef4444" },
                    ].map(d => (
                      <div key={d.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <div style={{ width: 8, height: 8, borderRadius: "50%", background: d.color }} />
                        <span style={{ color: "white", fontSize: 12 }}>{d.label}</span>
                        <span style={{ color: "#9ca3af", fontSize: 12 }}>{stats.iqc > 0 ? `${(d.value / stats.iqc * 100).toFixed(0)}%` : "—"}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {Object.keys(stats.defectTypeCounts).length > 0 && (
                <div style={{ background: "#1f2937", borderRadius: 10, padding: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, color: "#9ca3af", fontSize: 12, textTransform: "uppercase" }}>
                    <BarChart3 size={14} />{t("pdaHistory.defectTypeDistribution", locale)}
                  </div>
                  <BarChartSvg data={Object.entries(stats.defectTypeCounts).map(([code, cnt]) => ({ label: code.slice(0, 6), value: cnt, color: DEFECT_COLORS[code] || "#6b7280" }))} />
                </div>
              )}

              {trendData.length > 1 && (
                <div style={{ background: "#1f2937", borderRadius: 10, padding: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, color: "#9ca3af", fontSize: 12, textTransform: "uppercase" }}>
                    <TrendingUp size={14} />{t("pdaHistory.trend", locale)}
                  </div>
                  <TrendChartSvg data={trendData} locale={locale} />
                </div>
              )}
            </div>
          )}

          <div style={{ background: "#1f2937", borderRadius: 10, overflow: "hidden" }}>
            <div style={{ padding: "10px 14px", borderBottom: "1px solid #374151", display: "grid", gridTemplateColumns: "2fr 1.5fr 1fr 1fr 1fr 1fr 2fr", gap: 8, fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>
              <span>{t("pdaHistory.lotNo", locale)}</span>
              <span>{t("pdaHistory.type", locale)}</span>
              <span>{t("pdaHistory.material", locale)}</span>
              <span>{t("pdaHistory.decision", locale)}</span>
              <span>{t("pdaHistory.defectQty", locale)}</span>
              <span>{t("pdaHistory.operator", locale)}</span>
              <span>{t("pdaHistory.time", locale)}</span>
            </div>
            {filtered.map((r, i) => (
              <div key={r.id || i}>
                <div
                  onClick={() => setExpandedId(expandedId === (r.id || i) ? null : (r.id || i))}
                  style={{
                    padding: "10px 14px", borderBottom: "1px solid #2d3748", display: "grid",
                    gridTemplateColumns: "2fr 1.5fr 1fr 1fr 1fr 1fr 2fr", gap: 8, cursor: "pointer",
                    alignItems: "center", fontSize: 13, color: "white",
                    background: expandedId === (r.id || i) ? "#2d3748" : "transparent",
                  }}
                >
                  <span style={{ fontFamily: "monospace", fontSize: 12 }}>{r.lot_no}</span>
                  <span><DecisionBadge decision={r.record_type} /></span>
                  <span style={{ color: "#9ca3af", fontSize: 12 }}>{r.material_code}</span>
                  <span>{r.decision ? <DecisionBadge decision={r.decision} /> : <span style={{ color: "#6b7280" }}>—</span>}</span>
                  <span style={{ color: (r.defect_count || 0) > 0 ? "#ef4444" : "#6b7280" }}>{r.defect_count ?? "—"}</span>
                  <span style={{ color: "#9ca3af", fontSize: 12 }}>{r.operator_name || "—"}</span>
                  <span style={{ color: "#9ca3af", fontSize: 11 }}>{r.recorded_at ? new Date(r.recorded_at).toLocaleString() : "—"}</span>
                </div>
                {expandedId === (r.id || i) && (
                  <div style={{ padding: "12px 14px", background: "#1a1f2e", borderBottom: "1px solid #2d3748" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, fontSize: 12 }}>
                      {r.supplier_name_zh && <div><span style={{ color: "#6b7280" }}>Supplier: </span><span style={{ color: "white" }}>{r.supplier_name_zh}</span></div>}
                      {r.received_qty != null && <div><span style={{ color: "#6b7280" }}>Qty: </span><span style={{ color: "white" }}>{r.received_qty}</span></div>}
                      {r.msd_level && <div><span style={{ color: "#6b7280" }}>MSD: </span><span style={{ color: "white" }}>{r.msd_level}</span></div>}
                      {r.sample_size != null && <div><span style={{ color: "#6b7280" }}>Sample: </span><span style={{ color: "white" }}>{r.sample_size}</span></div>}
                      {r.defect_type && <div><span style={{ color: "#6b7280" }}>Defect: </span><span style={{ color: "white" }}>{r.defect_type}</span></div>}
                      {r.defect_severity && <div><span style={{ color: "#6b7280" }}>Severity: </span><span style={{ color: "white" }}>{r.defect_severity}</span></div>}
                      {r.defect_rate != null && <div><span style={{ color: "#6b7280" }}>Defect Rate: </span><span style={{ color: r.defect_rate > 0.05 ? "#ef4444" : "#22c55e" }}>{(r.defect_rate * 100).toFixed(1)}%</span></div>}
                      {r.decision_by && <div><span style={{ color: "#6b7280" }}>By: </span><span style={{ color: "white" }}>{r.decision_by}</span></div>}
                      {r.ornith_confidence != null && <div><span style={{ color: "#6b7280" }}>Confidence: </span><span style={{ color: "#f59e0b" }}>{(r.ornith_confidence * 100).toFixed(0)}%</span></div>}
                      {r.inspection_notes && <div style={{ gridColumn: "1 / -1" }}><span style={{ color: "#6b7280" }}>Notes: </span><span style={{ color: "white" }}>{r.inspection_notes}</span></div>}
                      {r.receiving_notes && <div style={{ gridColumn: "1 / -1" }}><span style={{ color: "#6b7280" }}>Notes: </span><span style={{ color: "white" }}>{r.receiving_notes}</span></div>}
                      {r.receiving_photo_url && r.receiving_photo_url.startsWith("data:") && (
                        <div style={{ gridColumn: "1 / -1" }}>
                          <img src={r.receiving_photo_url} alt="receiving" style={{ maxHeight: 80, borderRadius: 6 }} />
                        </div>
                      )}
                      {r.defect_photo_url && r.defect_photo_url.startsWith("data:") && (
                        <div style={{ gridColumn: "1 / -1" }}>
                          <img src={r.defect_photo_url} alt="defect" style={{ maxHeight: 80, borderRadius: 6 }} />
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
            {filtered.length === 0 && (
              <div style={{ padding: 24, textAlign: "center", color: "#6b7280" }}>
                {t("pdaHistory.noRecords", locale)}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
