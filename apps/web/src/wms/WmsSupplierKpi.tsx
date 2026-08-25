import { useState, useMemo } from "react";
import { Truck, TrendingUp, TrendingDown, BarChart3, Star } from "lucide-react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";

interface SupplierKpi {
  code: string;
  name: string;
  defectRate: number;
  onTimeDelivery: number;
  rejectCount: number;
  totalLots: number;
  avgLeadTimeDays: number;
  monthlyTrend: number[];
}

const mockSuppliers: SupplierKpi[] = [
  { code: "SUP-001", name: "深圳华新电子", defectRate: 1.2, onTimeDelivery: 97, rejectCount: 3, totalLots: 42, avgLeadTimeDays: 7, monthlyTrend: [98, 96, 97, 95, 97, 98] },
  { code: "SUP-002", name: "东莞利尔电子", defectRate: 2.8, onTimeDelivery: 88, rejectCount: 5, totalLots: 28, avgLeadTimeDays: 10, monthlyTrend: [85, 87, 90, 86, 88, 88] },
  { code: "SUP-003", name: "香港泰科源", defectRate: 0.5, onTimeDelivery: 99, rejectCount: 1, totalLots: 35, avgLeadTimeDays: 14, monthlyTrend: [99, 99, 98, 99, 100, 99] },
  { code: "SUP-DG-CONN", name: "东莞连接器厂", defectRate: 4.5, onTimeDelivery: 82, rejectCount: 8, totalLots: 18, avgLeadTimeDays: 5, monthlyTrend: [80, 78, 83, 85, 82, 82] },
  { code: "SUP-HN-PCB", name: "河南PCB科技", defectRate: 3.2, onTimeDelivery: 91, rejectCount: 4, totalLots: 22, avgLeadTimeDays: 12, monthlyTrend: [90, 92, 91, 89, 91, 91] },
  { code: "SUP-TPE-RES", name: "台北电阻厂", defectRate: 0.8, onTimeDelivery: 96, rejectCount: 2, totalLots: 31, avgLeadTimeDays: 8, monthlyTrend: [95, 96, 97, 95, 96, 96] },
  { code: "SUP-SH-IC", name: "上海IC代理", defectRate: 0.3, onTimeDelivery: 98, rejectCount: 1, totalLots: 15, avgLeadTimeDays: 21, monthlyTrend: [98, 99, 98, 97, 98, 98] },
  { code: "SUP-SZ-LED", name: "深圳LED厂", defectRate: 5.1, onTimeDelivery: 75, rejectCount: 6, totalLots: 12, avgLeadTimeDays: 9, monthlyTrend: [72, 74, 78, 75, 75, 75] },
];

function qualityScore(s: SupplierKpi): number {
  const defectScore = Math.max(0, 100 - s.defectRate * 10);
  const deliveryScore = s.onTimeDelivery;
  const rejectScore = Math.max(0, 100 - s.rejectCount * 5);
  return Math.round((defectScore + deliveryScore + rejectScore) / 3);
}

export function WmsSupplierKpi({ locale }: { locale: Locale }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [searchQ, setSearchQ] = useState("");

  const filtered = useMemo(() =>
    mockSuppliers.filter((s) => !searchQ || s.name.includes(searchQ) || s.code.includes(searchQ)),
    [searchQ]
  );

  const avgDefect = mockSuppliers.reduce((s, x) => s + x.defectRate, 0) / mockSuppliers.length;
  const avgDelivery = mockSuppliers.reduce((s, x) => s + x.onTimeDelivery, 0) / mockSuppliers.length;
  const avgLead = mockSuppliers.reduce((s, x) => s + x.avgLeadTimeDays, 0) / mockSuppliers.length;

  return (
    <div className="screen-stack">
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2><BarChart3 size={18} style={{ marginRight: 8, verticalAlign: "middle" }} />{t("wms.subnav.supplierKpi", locale)}</h2>
            <p>{t("wms.supplierKpiDesc", locale)}</p>
          </div>
          <input className="input" style={{ padding: "4px 10px", maxWidth: 220, fontSize: 12 }}
            value={searchQ} onChange={(e) => setSearchQ(e.target.value)} placeholder={t("wms.filterSupplier", locale)} />
        </div>
      </section>

      <section className="surface-panel">
        <div style={{ display: "flex", gap: 16 }}>
          {[
            { label: t("wms.totalSuppliers", locale), value: mockSuppliers.length, icon: <Truck size={18} />, color: "var(--info)" },
            { label: t("wms.avgDefectRate", locale), value: `${avgDefect.toFixed(1)}%`, icon: <TrendingDown size={18} />, color: avgDefect < 2 ? "var(--ok)" : avgDefect < 4 ? "var(--warn)" : "var(--danger)" },
            { label: t("wms.avgDeliveryRate", locale), value: `${avgDelivery.toFixed(1)}%`, icon: <TrendingUp size={18} />, color: avgDelivery >= 90 ? "var(--ok)" : "var(--warn)" },
            { label: t("wms.avgLeadTime", locale), value: `${avgLead.toFixed(1)}d`, icon: <Star size={18} />, color: "var(--muted)" },
          ].map((card) => (
            <div key={card.label} style={{
              flex: 1, padding: "16px 20px", borderRadius: 8, background: "var(--nav)",
              display: "flex", flexDirection: "column", gap: 4,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>{card.label}</span>
                <span style={{ color: card.color }}>{card.icon}</span>
              </div>
              <strong style={{ fontSize: 22, color: card.color }}>{card.value}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="surface-panel">
        <div className="section-header">
          <div><h3>{t("wms.supplierKpiDetail", locale)}</h3></div>
        </div>
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>{t("common.supplier", locale)}</th>
                <th>{t("wms.defectRate", locale)}</th>
                <th>{t("wms.onTimeDelivery", locale)}</th>
                <th>{t("wms.rejectCount", locale)}</th>
                <th>{t("wms.totalLots", locale)}</th>
                <th>{t("wms.avgLeadTime", locale)}</th>
                <th>{t("wms.qualityScore", locale)}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => {
                const score = qualityScore(s);
                const scoreColor = score >= 90 ? "var(--ok)" : score >= 75 ? "var(--warn)" : "var(--danger)";
                return (
                  <>
                    <tr key={s.code} onClick={() => setExpanded(expanded === s.code ? null : s.code)}
                      style={{ cursor: "pointer" }}>
                      <td><strong>{s.name}</strong><br /><code style={{ fontSize: 10, color: "var(--muted)" }}>{s.code}</code></td>
                      <td><span style={{ color: s.defectRate < 2 ? "var(--ok)" : s.defectRate < 4 ? "var(--warn)" : "var(--danger)", fontWeight: 600 }}>{s.defectRate}%</span></td>
                      <td><span style={{ color: s.onTimeDelivery >= 90 ? "var(--ok)" : "var(--warn)", fontWeight: 600 }}>{s.onTimeDelivery}%</span></td>
                      <td>{s.rejectCount}</td>
                      <td>{s.totalLots}</td>
                      <td>{s.avgLeadTimeDays}d</td>
                      <td>
                        <span style={{
                          display: "inline-block", padding: "2px 10px", borderRadius: 12,
                          background: scoreColor, color: "#fff", fontWeight: 600, fontSize: 13,
                        }}>{score}</span>
                      </td>
                    </tr>
                    {expanded === s.code && (
                      <tr key={`${s.code}-trend`}>
                        <td colSpan={7} style={{ padding: "12px 20px", background: "rgba(0,0,0,0.02)" }}>
                          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>{t("wms.monthlyDeliveryTrend", locale)}</div>
                          <div className="toolbar" style={{ gap: 4, alignItems: "flex-end" }}>
                            {s.monthlyTrend.map((val, i) => (
                              <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                                <div style={{
                                  width: 28, height: `${val * 0.6}px`, minHeight: 4, borderRadius: "4px 4px 0 0",
                                  background: val >= 90 ? "var(--ok)" : val >= 80 ? "var(--warn)" : "var(--danger)",
                                  transition: "height 0.3s",
                                }} />
                                <span style={{ fontSize: 10, color: "var(--muted)" }}>W{i + 1}</span>
                                <span style={{ fontSize: 10, fontWeight: 600 }}>{val}%</span>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
