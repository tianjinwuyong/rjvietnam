import { useState, useMemo } from "react";
import { BarChart3, TrendingUp, TrendingDown, Calendar } from "lucide-react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";

interface IqcReportRow {
  date: string;
  materialCode: string;
  lotNo: string;
  supplier: string;
  result: "pass" | "fail" | "hold";
  qty: number;
  inspector: string;
}

function randomDate(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - Math.floor(Math.random() * daysAgo));
  return d.toISOString().slice(0, 10);
}

const suppliers = ["SUP-001 华新电子", "SUP-002 利尔电子", "SUP-003 泰科源", "SUP-DG-CONN 东莞连接器", "SUP-HN-PCB 河南PCB"];
const materials = ["CAP-CER-100UF", "RES-SMD-10K", "IC-MCU-STM32", "LED-RED-0805", "CONN-USB-C-30P", "PCB-AURORA-CTRL"];
const inspectors = ["VN_IQC_001", "VN_IQC_002", "VN_IQC_003", "CN_IQC_001"];
const results: IqcReportRow["result"][] = ["pass", "pass", "pass", "pass", "pass", "pass", "pass", "fail", "hold"];

function generateMockData(): IqcReportRow[] {
  const rows: IqcReportRow[] = [];
  for (let i = 0; i < 60; i++) {
    rows.push({
      date: randomDate(30),
      materialCode: materials[Math.floor(Math.random() * materials.length)],
      lotNo: `LOT-${randomDate(30).replace(/-/g, "")}-${String(100 + i).padStart(3, "0")}`,
      supplier: suppliers[Math.floor(Math.random() * suppliers.length)],
      result: results[Math.floor(Math.random() * results.length)],
      qty: Math.round(1000 + Math.random() * 50000),
      inspector: inspectors[Math.floor(Math.random() * inspectors.length)],
    });
  }
  return rows.sort((a, b) => b.date.localeCompare(a.date));
}

export function WmsIqcReport({ locale }: { locale: Locale }) {
  const [data] = useState<IqcReportRow[]>(generateMockData);
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10);
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));

  const filtered = useMemo(() =>
    data.filter((r) => r.date >= dateFrom && r.date <= dateTo),
    [data, dateFrom, dateTo]
  );

  const stats = useMemo(() => {
    const total = filtered.length;
    const pass = filtered.filter((r) => r.result === "pass").length;
    const fail = filtered.filter((r) => r.result === "fail").length;
    const hold = filtered.filter((r) => r.result === "hold").length;
    return { total, pass, fail, hold, passRate: total > 0 ? (pass / total * 100) : 0 };
  }, [filtered]);

  const bySupplier = useMemo(() => {
    const map = new Map<string, { total: number; pass: number }>();
    for (const row of filtered) {
      if (!map.has(row.supplier)) map.set(row.supplier, { total: 0, pass: 0 });
      const s = map.get(row.supplier)!;
      s.total++;
      if (row.result === "pass") s.pass++;
    }
    return Array.from(map.entries()).map(([name, s]) => ({ name, total: s.total, pass: s.pass, rate: s.total > 0 ? (s.pass / s.total * 100) : 0 }));
  }, [filtered]);

  return (
    <div className="screen-stack">
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("wms.subnav.iqcReport", locale)}</h2>
            <p>{t("wms.iqcReportDesc", locale)}</p>
          </div>
          <div className="toolbar" style={{ gap: 8 }}>
            <Calendar size={14} />
            <input type="date" className="input" style={{ padding: "4px 8px", fontSize: 12 }} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            <span style={{ color: "var(--muted)" }}>~</span>
            <input type="date" className="input" style={{ padding: "4px 8px", fontSize: 12 }} value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
        </div>
      </section>

      <section className="surface-panel">
        <div style={{ display: "flex", gap: 16 }}>
          {[
            { label: t("wms.totalInspections", locale), value: stats.total, color: "var(--info)" },
            { label: t("wms.passRate", locale), value: `${stats.passRate.toFixed(1)}%`, color: "var(--ok)" },
            { label: t("wms.failRate", locale), value: `${stats.total > 0 ? (stats.fail / stats.total * 100).toFixed(1) : "0"}%`, color: "var(--danger)" },
            { label: t("iqc.pending", locale), value: stats.hold, color: "var(--warn)" },
          ].map((card) => (
            <div key={card.label} style={{
              flex: 1, padding: "16px 20px", borderRadius: 8, background: "var(--nav)",
              display: "flex", flexDirection: "column", gap: 4,
            }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{card.label}</span>
              <strong style={{ fontSize: 24, color: card.color }}>{card.value}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="surface-panel">
        <div className="section-header">
          <div><h3>{t("wms.supplierPassRate", locale)}</h3></div>
        </div>
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>{t("common.supplier", locale)}</th>
                <th>{t("wms.totalInspections", locale)}</th>
                <th>{t("wms.passCount", locale)}</th>
                <th>{t("wms.passRate", locale)}</th>
                <th>{t("wms.trend", locale)}</th>
              </tr>
            </thead>
            <tbody>
              {bySupplier.map((s) => (
                <tr key={s.name}>
                  <td><strong>{s.name}</strong></td>
                  <td>{s.total}</td>
                  <td>{s.pass}</td>
                  <td>
                    <span style={{
                      color: s.rate >= 95 ? "var(--ok)" : s.rate >= 80 ? "var(--warn)" : "var(--danger)",
                      fontWeight: 600,
                    }}>{s.rate.toFixed(1)}%</span>
                  </td>
                  <td>{s.rate >= 95 ? <TrendingUp size={16} color="var(--ok)" /> : <TrendingDown size={16} color="var(--danger)" />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="surface-panel">
        <div className="section-header">
          <div><h3>{t("wms.inspectionRecords", locale)}</h3></div>
        </div>
        {filtered.length === 0 ? (
          <div style={{ padding: 24, color: "var(--muted)", textAlign: "center" }}>{t("common.noData", locale)}</div>
        ) : (
          <div className="table-shell" style={{ maxHeight: 400, overflow: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>{t("common.date", locale)}</th>
                  <th>{t("common.material", locale)}</th>
                  <th>{t("common.lot", locale)}</th>
                  <th>{t("common.supplier", locale)}</th>
                  <th>{t("common.result", locale)}</th>
                  <th>{t("common.qty", locale)}</th>
                  <th>{t("common.inspector", locale)}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row, i) => (
                  <tr key={i}>
                    <td style={{ whiteSpace: "nowrap" }}>{row.date}</td>
                    <td><strong>{row.materialCode}</strong></td>
                    <td><code style={{ fontSize: 11 }}>{row.lotNo}</code></td>
                    <td style={{ fontSize: 12 }}>{row.supplier}</td>
                    <td>
                      <span className={`badge badge-${row.result === "pass" ? "ok" : row.result === "fail" ? "danger" : "warning"}`}>
                        {row.result === "pass" ? t("iqc.released", locale) : row.result === "fail" ? t("iqc.rejected", locale) : t("iqc.hold", locale)}
                      </span>
                    </td>
                    <td>{row.qty.toLocaleString()}</td>
                    <td style={{ fontSize: 12 }}>{row.inspector}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
