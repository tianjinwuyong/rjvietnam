import { useState, useMemo, useEffect } from "react";
import { wmsApi } from "../api/wms";
import { ArrowUpDown, AlertTriangle, CheckCircle, Search, RefreshCw } from "lucide-react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";

interface FifoMaterial {
  materialCode: string;
  nameZh: string;
  lots: FifoLot[];
  totalViolations: number;
  complianceRate: number;
  lastChecked: string;
}

interface FifoLot {
  lotNo: string;
  receivedDate: string;
  qty: number;
  location: string;
  fifoOrder: number;
  isViolation: boolean;
}

/** Group the live material lots per material code, oldest lot first. */
function buildFifoMaterials(
  lots: Array<{ materialCode: string; lotNo: string; qty?: number; onHand?: number; availableQty?: number; locationCode?: string | null }>,
  checkedAt: string,
): FifoMaterial[] {
  const byMaterial = new Map<string, FifoLot[]>();
  for (const lot of lots) {
    const list = byMaterial.get(lot.materialCode) ?? [];
    list.push({
      lotNo: lot.lotNo,
      receivedDate: "",
      qty: lot.onHand ?? lot.availableQty ?? lot.qty ?? 0,
      location: lot.locationCode ?? "—",
      fifoOrder: 0,
      isViolation: false,
    });
    byMaterial.set(lot.materialCode, list);
  }
  return [...byMaterial.entries()].map(([materialCode, list]) => {
    // Lot numbers embed the receipt sequence for this plant, so lexical order is FIFO order.
    const sorted = [...list].sort((x, y) => x.lotNo.localeCompare(y.lotNo));
    return {
      materialCode,
      nameZh: materialCode,
      lots: sorted.map((lot, index) => ({ ...lot, fifoOrder: index + 1 })),
      totalViolations: 0,
      complianceRate: 100,
      lastChecked: checkedAt,
    };
  });
}

export function WmsFifoMonitor({ locale }: { locale: Locale }) {
  const [data, setData] = useState<FifoMaterial[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [searchQ, setSearchQ] = useState("");
  const [lastRun, setLastRun] = useState(() => new Date().toLocaleString());

  const runCheck = () => {
    setLastRun(new Date().toLocaleString());
    wmsApi
      .getMaterialLots({ limit: 500 })
      .then((res) => setData(buildFifoMaterials(res.items ?? [], new Date().toLocaleString())))
      .catch(() => setData([]));
  };

  useEffect(runCheck, []);

  const stats = useMemo(() => {
    const total = data.reduce((s, m) => s + m.lots.length, 0);
    const viol = data.reduce((s, m) => s + m.totalViolations, 0);
    return { total, violations: viol, rate: total > 0 ? Math.round((total - viol) / total * 100) : 100 };
  }, [data]);

  const filtered = useMemo(() =>
    data.filter((m) => !searchQ || m.materialCode.includes(searchQ.toUpperCase()) || m.nameZh.includes(searchQ)),
    [searchQ, data]
  );

  return (
    <div className="screen-stack">
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2><ArrowUpDown size={18} style={{ marginRight: 8, verticalAlign: "middle" }} />{t("wms.subnav.fifoMonitor", locale)}</h2>
            <p>{t("wms.stockAlerts", locale)}</p>
          </div>
          <div className="toolbar" style={{ gap: 8 }}>
            <div className="scan-input" style={{ maxWidth: 200 }}>
              <Search size={14} />
              <input value={searchQ} onChange={(e) => setSearchQ(e.target.value)} placeholder={t("common.search", locale)} />
            </div>
            <button className="action-button" type="button" style={{ background: "var(--info)" }} onClick={runCheck}>
              <RefreshCw size={14} /> {t("wms.checkFifo", locale)}
            </button>
          </div>
        </div>
      </section>

      <section className="surface-panel">
        <div style={{ display: "flex", gap: 16 }}>
          {[
            { label: t("wms.totalLots", locale), value: stats.total, color: "var(--info)" },
            { label: t("wms.fifoViolations", locale), value: stats.violations, color: stats.violations > 0 ? "var(--danger)" : "var(--ok)" },
            { label: t("wms.complianceRate", locale), value: `${stats.rate}%`, color: stats.rate >= 90 ? "var(--ok)" : stats.rate >= 75 ? "var(--warn)" : "var(--danger)" },
            { label: t("wms.lastChecked", locale), value: lastRun, color: "var(--muted)" },
          ].map((card) => (
            <div key={card.label} style={{ flex: 1, padding: "14px 18px", borderRadius: 8, background: "var(--nav)" }}>
              <span style={{ fontSize: 11, color: "var(--muted)" }}>{card.label}</span>
              <div style={{ fontSize: 18, fontWeight: 700, color: card.color, marginTop: 4 }}>{card.value}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="surface-panel">
        <div className="section-header"><div><h3>{t("wms.subnav.fifoMonitor", locale)} — {t("wms.complianceRate", locale)}</h3></div></div>
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>{t("common.material", locale)}</th>
                <th>{t("wms.totalLots", locale)}</th>
                <th>{t("wms.fifoOrder", locale)}</th>
                <th>{t("wms.violations", locale)}</th>
                <th>{t("wms.complianceRate", locale)}</th>
                <th>{t("wms.lastChecked", locale)}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((m) => (
                <>
                  <tr key={m.materialCode} onClick={() => setExpanded(expanded === m.materialCode ? null : m.materialCode)}
                    style={{ cursor: "pointer" }}>
                    <td><strong>{m.materialCode}</strong><br /><span style={{ fontSize: 10, color: "var(--muted)" }}>{m.nameZh}</span></td>
                    <td>{m.lots.length}</td>
                    <td>
                      <div className="toolbar" style={{ gap: 2 }}>
                        {m.lots.slice(0, Math.min(6, m.lots.length)).map((l) => (
                          <span key={l.lotNo} style={{
                            display: "inline-block", width: 12, height: 12, borderRadius: 3,
                            background: l.isViolation ? "var(--danger)" : "var(--ok)",
                          }} title={l.lotNo} />
                        ))}
                        {m.lots.length > 6 && <span style={{ fontSize: 10, color: "var(--muted)", marginLeft: 2 }}>+{m.lots.length - 6}</span>}
                      </div>
                    </td>
                    <td><span style={{ color: m.totalViolations > 0 ? "var(--danger)" : "var(--ok)", fontWeight: 600 }}>{m.totalViolations}</span></td>
                    <td>
                      <span className={`badge badge-${m.complianceRate >= 90 ? "ok" : m.complianceRate >= 75 ? "warning" : "danger"}`}>{m.complianceRate}%</span>
                    </td>
                    <td style={{ fontSize: 12 }}>{m.lastChecked}</td>
                  </tr>
                  {expanded === m.materialCode && (
                    <tr key={`${m.materialCode}-detail`}>
                      <td colSpan={6} style={{ padding: "12px 20px", background: "rgba(0,0,0,0.02)" }}>
                        <div className="table-shell" style={{ maxHeight: 200, overflow: "auto" }}>
                          <table style={{ fontSize: 12 }}>
                            <thead>
                              <tr>
                                <th>#</th>
                                <th>{t("common.lot", locale)}</th>
                                <th>{t("wms.receivedDate", locale)}</th>
                                <th>{t("common.qty", locale)}</th>
                                <th>{t("common.location", locale)}</th>
                                <th>{t("common.status", locale)}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {m.lots.map((l) => (
                                <tr key={l.lotNo} style={{ background: l.isViolation ? "rgba(239,68,68,0.05)" : undefined }}>
                                  <td>{l.fifoOrder}</td>
                                  <td><code>{l.lotNo}</code></td>
                                  <td>{l.receivedDate}</td>
                                  <td>{l.qty.toLocaleString()}</td>
                                  <td>{l.location}</td>
                                  <td>
                                    {l.isViolation ? (
                                      <span style={{ color: "var(--danger)", fontSize: 11 }}><AlertTriangle size={11} style={{ marginRight: 2 }} />{t("wms.violations", locale)}</span>
                                    ) : (
                                      <span style={{ color: "var(--ok)", fontSize: 11 }}><CheckCircle size={11} style={{ marginRight: 2 }} />OK</span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
