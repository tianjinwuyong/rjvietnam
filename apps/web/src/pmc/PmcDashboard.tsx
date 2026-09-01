import { useEffect, useState } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { pmcApi } from "../api";
import { AiPatrolChat } from "../ai/AiPatrolChat";
import { pmcPatrol } from "../ai/patrol";
import type { WorkOrder, CustomerPo } from "../api";
import { apiClient, type ListEnvelope } from "../api/client";

function computeRisk(dueDate: string): "low" | "medium" | "high" {
  const due = new Date(dueDate);
  const now = new Date();
  const diffDays = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays <= 3) return "high";
  if (diffDays <= 7) return "medium";
  return "low";
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toISOString().slice(0, 10);
  } catch {
    return dateStr;
  }
}

export function PmcDashboard({ locale }: { locale: Locale }) {
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [customerPos, setCustomerPos] = useState<(CustomerPo & { productCode?: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [supplySignals,setSupplySignals]=useState<any[]>([]);

  useEffect(() => {
    Promise.all([
      pmcApi.getWorkOrders({ limit: 200 }),
      pmcApi.getCustomerPos(),
      apiClient.get<ListEnvelope<any>>("/pmc/supplier-supply-signals").catch(()=>({items:[]} as ListEnvelope<any>)),
    ]).then(([woRes, poRes,signalRes]) => {
      const wos = woRes.items;
      const pos = poRes.items;

      // Derive productCode for each PO from related work orders
      const posWithProduct = pos.map((po) => {
        const relatedWo = wos.find((w) => w.poNumber === po.poNumber);
        return { ...po, productCode: relatedWo?.productCode };
      });

      setWorkOrders(wos);
      setCustomerPos(posWithProduct);
      setSupplySignals(signalRes.items||[]);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const totalWos = workOrders.length;
  const runningWos = workOrders.filter((wo) => wo.status === "running").length;
  const releasedWos = workOrders.filter((wo) => wo.status === "released").length;
  const holdWos = workOrders.filter((wo) => wo.status === "hold").length;
  const highRiskPos = customerPos.filter((po) => computeRisk(po.dueDate) === "high").length;

  if (loading) {
    return (
      <div className="screen-stack">
        <div className="metric-grid">
          {[1, 2, 3, 4, 5].map((i) => (
            <article className="stat-card" key={i}>
              <span className="skeleton-text" style={{ width: "60%", height: 14, display: "block", borderRadius: 4, background: "var(--nav)", animation: "pulse 1.5s infinite" }} />
              <strong style={{ fontSize: 28, marginTop: 8, display: "block" }}>—</strong>
            </article>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="screen-stack">
      <div className="metric-grid">
        <article className="stat-card">
          <span>{t("common.workOrder", locale)}</span>
          <strong>{totalWos}</strong>
          <span className="badge badge-info">{t("common.total", locale)}</span>
        </article>
        <article className="stat-card">
          <span>{t("status.running", locale)}</span>
          <strong>{runningWos}</strong>
          <span className="badge badge-ok">{t("status.running", locale)}</span>
        </article>
        <article className="stat-card">
          <span>{t("status.released", locale)}</span>
          <strong>{releasedWos}</strong>
          <span className="badge badge-info">{t("status.released", locale)}</span>
        </article>
        <article className="stat-card">
          <span>{t("status.hold", locale)}</span>
          <strong>{holdWos}</strong>
          <span className="badge badge-warning">{t("status.hold", locale)}</span>
        </article>
        <article className="stat-card">
          <span>{t("common.risk", locale)}</span>
          <strong>{highRiskPos}</strong>
          <span className={`badge badge-${highRiskPos > 0 ? "danger" : "ok"}`}>{t(highRiskPos > 0 ? "risk.high" : "risk.low", locale)}</span>
        </article>
      </div>

      <div className="content-grid two">
        <section className="surface-panel">
          <div className="section-header">
            <div>
              <h2>{t("dashboard.deliveryWatch", locale)}</h2>
              <p>{t("common.risk", locale)}</p>
            </div>
          </div>
          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th>{t("table.po", locale)}</th>
                  <th>{t("common.product", locale)}</th>
                  <th>{t("common.qty", locale)}</th>
                  <th>{t("table.dueDate", locale)}</th>
                  <th>{t("table.risk", locale)}</th>
                </tr>
              </thead>
              <tbody>
                {customerPos.map((po) => {
                  const risk = computeRisk(po.dueDate);
                  return (
                    <tr key={po.id}>
                      <td><strong>{po.poNumber}</strong></td>
                      <td>{po.productCode ?? "—"}</td>
                      <td>{po.orderQty?.toLocaleString() ?? "—"}</td>
                      <td>{formatDate(po.dueDate)}</td>
                      <td>
                        <span className={`badge badge-${risk === "high" ? "danger" : risk === "medium" ? "warning" : "ok"}`}>
                          {t(`risk.${risk}` as any, locale)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="surface-panel">
          <div className="section-header">
            <div>
              <h2>{t("dashboard.lineHealth", locale)}</h2>
              <p>{t("common.status", locale)}</p>
            </div>
          </div>
          <div className="status-stack">
            {workOrders.slice(0, 5).map((wo) => (
              <div className="status-row" key={wo.id}>
                <div>
                  <strong>{wo.lineNameZh ?? wo.lineCode}</strong>
                  <span style={{ color: "var(--muted)", fontSize: 12 }}>
                    {wo.code ?? t("status.idle", locale)}
                  </span>
                </div>
                <span className={`badge badge-${wo.status === "running" ? "ok" : wo.status === "released" ? "info" : wo.status === "hold" ? "warning" : "muted"}`}>
                  {t(wo.status === "running" ? "status.running" : wo.status === "released" ? "status.released" : wo.status === "hold" ? "status.hold" : wo.status === "draft" ? "status.draft" : "status.closed", locale)}
                </span>
              </div>
            ))}
            {workOrders.length === 0 && (
              <p style={{ color: "var(--muted)", padding: 8, fontSize: 13 }}>{t("common.noData", locale)}</p>
            )}
          </div>
        </section>
      </div>

      <section className="surface-panel">
        <div className="section-header"><div><h2>供应商交付进度对生产计划的影响</h2><p>供应商完成数量只形成排产风险信号；PMC 确认后才调整正式计划。</p></div><span className={`badge badge-${supplySignals.some(x=>x.risk_level==="HIGH")?"danger":"info"}`}>{supplySignals.filter(x=>x.review_status==="PENDING_PMC_REVIEW").length} 项待评审</span></div>
        <div className="table-shell"><table><thead><tr><th>采购 PO</th><th>供应商</th><th>完成进度</th><th>供应缺口</th><th>距离交期</th><th>风险</th><th>PMC 状态</th></tr></thead><tbody>{supplySignals.map(x=><tr key={x.po_no}><td><b>{x.po_no}</b></td><td>{x.supplier_name||x.supplier_code}</td><td><b>{Number(x.completed_quantity).toLocaleString()} / {Number(x.ordered_quantity).toLocaleString()}</b><div className="progress" title={`${x.completion_percent}%`}><span style={{width:`${Math.min(100,Number(x.completion_percent))}%`}}/></div></td><td>{Number(x.remaining_quantity).toLocaleString()}</td><td>{x.days_remaining==null?"未设置":x.days_remaining<0?`逾期 ${Math.abs(x.days_remaining)} 天`:`剩余 ${x.days_remaining} 天`}</td><td><span className={`badge badge-${x.risk_level==="HIGH"?"danger":x.risk_level==="MEDIUM"?"warning":"ok"}`}>{x.risk_level}</span></td><td>{x.review_status}</td></tr>)}{!supplySignals.length&&<tr><td colSpan={7} style={{textAlign:"center",padding:24,color:"var(--muted)"}}>暂无供应商进度风险信号</td></tr>}</tbody></table></div>
      </section>

      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("pmc.releaseQueue", locale)}</h2>
            <p>{t("common.overview", locale)}</p>
          </div>
        </div>
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>{t("common.workOrder", locale)}</th>
                <th>{t("common.product", locale)}</th>
                <th>{t("common.line", locale)}</th>
                <th>{t("common.qty", locale)}</th>
                <th>{t("common.completed", locale)}</th>
                <th>{t("table.ready", locale)}</th>
                <th>{t("table.status", locale)}</th>
              </tr>
            </thead>
            <tbody>
              {workOrders.map((wo) => (
                <tr key={wo.id}>
                  <td><strong>{wo.code}</strong></td>
                  <td>{wo.productCode}</td>
                  <td>{wo.lineNameZh ?? wo.lineCode}</td>
                  <td>{wo.plannedQty.toLocaleString()}</td>
                  <td>{wo.completedQty.toLocaleString()}</td>
                  <td>
                    <div className="progress" title="100%">
                      <span style={{ width: "100%" }} />
                    </div>
                  </td>
                  <td>
                    <span className={`badge badge-${wo.status === "running" ? "ok" : wo.status === "released" ? "info" : wo.status === "hold" ? "warning" : "muted"}`}>
                      {t(wo.status === "running" ? "status.running" : wo.status === "released" ? "status.released" : wo.status === "hold" ? "status.hold" : wo.status === "draft" ? "status.draft" : "status.closed", locale)}
                    </span>
                  </td>
                </tr>
              ))}
              {workOrders.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>
                    {t("common.noData", locale)}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <AiPatrolChat patrol={pmcPatrol(locale)} locale={locale} />
    </div>
  );
}
