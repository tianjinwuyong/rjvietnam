import { useState, useMemo } from "react";
import { TrendingUp, TrendingDown, BarChart3, Activity } from "lucide-react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";

interface WeeklyQuality {
  week: string;
  categories: { name: string; passRate: number; sampleSize: number; defectCount: number }[];
}

function generateTrendData(): WeeklyQuality[] {
  const categories = ["电阻 Resistor", "电容 Capacitor", "IC 集成电路", "连接器 Connector", "PCB 线路板"];
  const weeks: WeeklyQuality[] = [];
  for (let w = 12; w >= 1; w--) {
    const d = new Date();
    d.setDate(d.getDate() - w * 7);
    const weekLabel = `${d.getMonth() + 1}/${Math.ceil(d.getDate() / 7)}W`;
    weeks.push({
      week: weekLabel,
      categories: categories.map((cat) => {
        const baseRate = cat === "IC 集成电路" ? 99 : cat === "PCB 线路板" ? 95 : 97;
        const variance = (Math.random() - 0.3) * 4;
        const passRate = Math.min(100, Math.max(85, baseRate + variance));
        const sampleSize = Math.round(50 + Math.random() * 200);
        const defectCount = Math.round(sampleSize * (100 - passRate) / 100);
        return { name: cat, passRate: Math.round(passRate * 10) / 10, sampleSize, defectCount };
      }),
    });
  }
  return weeks;
}

export function WmsQualityTrend({ locale }: { locale: Locale }) {
  const [data] = useState<WeeklyQuality[]>(generateTrendData);
  const [filterCat, setFilterCat] = useState("");

  const categories = useMemo(() =>
    data[0]?.categories.map((c) => c.name) ?? [],
    [data]
  );

  const filteredData = useMemo(() => {
    if (!filterCat) return data;
    return data.map((w) => ({
      ...w,
      categories: w.categories.filter((c) => c.name === filterCat),
    }));
  }, [data, filterCat]);

  const latest = data[data.length - 1];
  const overallPassRate = latest ? Math.round(latest.categories.reduce((s, c) => s + c.passRate, 0) / latest.categories.length * 10) / 10 : 0;
  const totalLots = latest ? latest.categories.reduce((s, c) => s + c.sampleSize, 0) : 0;
  const totalDefects = latest ? latest.categories.reduce((s, c) => s + c.defectCount, 0) : 0;
  const earlier = data.length >= 2 ? data[data.length - 2] : null;
  const prevRate = earlier ? Math.round(earlier.categories.reduce((s, c) => s + c.passRate, 0) / earlier.categories.length * 10) / 10 : 0;
  const trend = overallPassRate - prevRate;

  return (
    <div className="screen-stack">
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2><Activity size={18} style={{ marginRight: 8, verticalAlign: "middle" }} />{t("wms.subnav.qualityTrend", locale)}</h2>
            <p>{t("wms.qualityTrendDesc", locale)}</p>
          </div>
          <select className="input" style={{ padding: "4px 8px", fontSize: 12 }} value={filterCat} onChange={(e) => setFilterCat(e.target.value)}>
            <option value="">{t("wms.allCategories", locale)}</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </section>

      <section className="surface-panel">
        <div style={{ display: "flex", gap: 16 }}>
          {[
            { label: t("wms.overallPassRate", locale), value: `${overallPassRate}%`, color: overallPassRate >= 97 ? "var(--ok)" : overallPassRate >= 93 ? "var(--warn)" : "var(--danger)" },
            { label: t("wms.totalInspections", locale), value: totalLots.toLocaleString(), color: "var(--info)" },
            { label: t("wms.defectCount", locale), value: totalDefects, color: "var(--danger)" },
            { label: t("wms.trend", locale), value: `${trend >= 0 ? "+" : ""}${trend.toFixed(1)}%`, color: trend >= 0 ? "var(--ok)" : "var(--danger)", icon: trend >= 0 ? <TrendingUp size={18} /> : <TrendingDown size={18} /> },
          ].map((card) => (
            <div key={card.label} style={{
              flex: 1, padding: "16px 20px", borderRadius: 8, background: "var(--nav)",
              display: "flex", flexDirection: "column", gap: 4,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>{card.label}</span>
                {card.icon && <span style={{ color: card.color }}>{card.icon}</span>}
              </div>
              <strong style={{ fontSize: 22, color: card.color }}>{card.value}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="surface-panel">
        <div className="section-header">
          <div><h3>{t("wms.weeklyPassRateTrend", locale)}</h3></div>
        </div>
        <div style={{ overflowX: "auto", padding: "8px 0" }}>
          <div className="toolbar" style={{ gap: 8, minWidth: filteredData.length * 60 }}>
            {filteredData.map((week) => {
              const avgRate = week.categories.length > 0
                ? Math.round(week.categories.reduce((s, c) => s + c.passRate, 0) / week.categories.length * 10) / 10
                : 0;
              const barColor = avgRate >= 97 ? "var(--ok)" : avgRate >= 93 ? "var(--warn)" : "var(--danger)";
              return (
                <div key={week.week} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                  <div style={{ height: 120, display: "flex", alignItems: "flex-end" }}>
                    <div style={{
                      width: 36, height: `${avgRate * 0.8}px`, minHeight: 4, borderRadius: "4px 4px 0 0",
                      background: barColor, transition: "height 0.3s",
                    }} />
                  </div>
                  <span style={{ fontSize: 10, color: "var(--muted)" }}>{week.week}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: barColor }}>{avgRate}%</span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {filterCat && (
        <section className="surface-panel">
          <div className="section-header">
            <div><h3>{filterCat} — {t("wms.detail", locale)}</h3></div>
          </div>
          {filteredData.length > 0 && filteredData[0].categories.length > 0 && (
            <div className="table-shell">
              <table>
                <thead>
                  <tr>
                    <th>{t("common.week", locale)}</th>
                    <th>{t("wms.sampleSize", locale)}</th>
                    <th>{t("wms.defectCount", locale)}</th>
                    <th>{t("wms.passRate", locale)}</th>
                    <th>{t("wms.trend", locale)}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredData.map((week, wi) => {
                    const cat = week.categories[0];
                    const prevWi = wi > 0 ? filteredData[wi - 1].categories[0] : null;
                    const diff = prevWi ? (cat.passRate - prevWi.passRate).toFixed(1) : "—";
                    return (
                      <tr key={week.week}>
                        <td>{week.week}</td>
                        <td>{cat.sampleSize}</td>
                        <td>{cat.defectCount}</td>
                        <td><span style={{ color: cat.passRate >= 97 ? "var(--ok)" : cat.passRate >= 93 ? "var(--warn)" : "var(--danger)", fontWeight: 600 }}>{cat.passRate}%</span></td>
                        <td style={{ color: diff === "—" ? "var(--muted)" : Number(diff) >= 0 ? "var(--ok)" : "var(--danger)", fontSize: 12 }}>
                          {diff === "—" ? "—" : `${Number(diff) >= 0 ? "+" : ""}${diff}%`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
