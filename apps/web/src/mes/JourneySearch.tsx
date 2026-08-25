import { useState } from "react";
import { Search, Package, Truck, AlertCircle, CheckCircle, Clock, Map, List } from "lucide-react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { mesApi, apiClient } from "../api";

type SearchMode = "sn" | "container";
type ViewMode = "plan" | "actual";

const eventTypeColors: Record<string, string> = {
  LINE_ENTRY: "var(--ok)",
  STATION_ENTER: "var(--ok)",
  STATION_EXIT: "var(--info)",
  NG_DEFECT: "var(--danger)",
  NG_PICKED: "var(--warn)",
  NG_REPAIRED: "var(--ok)",
  NG_REVIVED: "var(--ok)",
  NG_SCRAPPED: "var(--critical)",
  NG_SAMPLE: "var(--warn)",
  PACKAGING: "var(--info)",
  PALLETIZING: "var(--info)",
  ONLINE: "var(--ok)",
  WAREHOUSE_IN: "var(--info)",
  STORAGE: "var(--ok)",
  MOVE: "var(--info)",
  TRANSFER: "var(--info)",
  EXPORT: "var(--warn)",
  IN_TRANSIT: "var(--warn)",
  SOLD: "var(--ok)",
  RETURN_REQUEST: "var(--critical)",
  RETURN_INBOUND: "var(--critical)",
  RETURN_REPAIR: "var(--warn)",
  DESTROY: "var(--critical)",
  OUTBOUND: "var(--ok)",
  NG: "var(--danger)",
  RETURN: "var(--ok)",
  SCRAP: "var(--critical)",
  SAMPLE: "var(--warn)",
  RE_WAREHOUSE: "var(--info)",
};

const eventStageLabels: Record<string, string> = {
  LINE: "生产线",
  STATION: "工站",
  REPAIR: "维修",
  NG: "NG",
  PACK: "包装",
  OUTBOUND: "出货",
  PRODUCTION: "生产",
  WAREHOUSE: "仓库",
  DISTRIBUTION: "分销",
  RETURN: "退货",
  DESTRUCTION: "销毁",
  SAMPLE: "样品",
  COMPLETED: "完成",
};

function PlanNodeRow({ node, isLast }: { node: any; isLast: boolean }) {
  const exitColors: Record<string, string> = { NG: "var(--danger)", SCRAP: "var(--critical)", SAMPLE: "var(--warn)", RETURN: "var(--ok)", RETURN_REQUEST: "var(--critical)", DESTROY: "var(--critical)", RE_WAREHOUSE: "var(--info)" };
  return (
    <tr style={{ background: isLast ? "rgba(34,197,94,0.05)" : undefined }}>
      <td style={{ fontWeight: 600 }}>{node.stepNo}</td>
      <td>{node.stationType || node.eventType || "—"}</td>
      <td>{node.stationCode || node.locationCode || "—"}</td>
      <td>{node.stationName || node.locationName || "—"}</td>
      <td>{node.requiredScan !== undefined ? (node.requiredScan ? "是" : "否") : "—"}</td>
      <td>
        {node.exits?.length > 0 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {node.exits.map((exit: any, i: number) => (
              <span key={i} style={{ fontSize: 11, padding: "2px 6px", borderRadius: 4, background: exitColors[exit.type] || "var(--text-secondary)", color: "#fff" }}>
                {exit.type}: {exit.label}
              </span>
            ))}
          </div>
        ) : "—"}
      </td>
      <td>{node.description || (node.exits?.length > 0 ? node.exits[0].description : "—")}</td>
    </tr>
  );
}

function SnActualRow({ event }: { event: any }) {
  const color = eventTypeColors[event.eventType] || "var(--text)";
  return (
    <tr>
      <td><span style={{ color, fontWeight: 600 }}>{event.eventType}</span></td>
      <td>{eventStageLabels[event.eventStage] || event.eventStage}</td>
      <td>{event.stationCode || "—"}</td>
      <td>{event.stationName || "—"}</td>
      <td>{event.result || "—"}</td>
      <td>{event.defectCode || "—"}</td>
      <td>{event.operator || "—"}</td>
      <td>{event.eventAt ? new Date(event.eventAt).toLocaleString() : "—"}</td>
    </tr>
  );
}

function BoxActualRow({ event }: { event: any }) {
  const color = eventTypeColors[event.eventType] || "var(--text)";
  return (
    <tr>
      <td><span style={{ color, fontWeight: 600 }}>{event.eventType}</span></td>
      <td>{eventStageLabels[event.eventStage] || event.eventStage}</td>
      <td>{event.locationCode || "—"}</td>
      <td>{event.locationName || "—"}</td>
      <td>{event.nextLocationCode || "—"}</td>
      <td>{event.nextLocationName || "—"}</td>
      <td>{event.operator || "—"}</td>
      <td>{event.eventAt ? new Date(event.eventAt).toLocaleString() : "—"}</td>
    </tr>
  );
}

interface SnPlanData { sn: string; workOrderCode: string; productCode: string; planNodes: any[]; totalSteps: number; }
interface SnActualData { sn: string; pastEvents: any[]; ngDefectRecords: any[]; repairWorkOrders: any[]; }
interface BoxPlanData { containerId: string; workOrderCode: string; planNodes: any[]; totalSteps: number; }
interface BoxActualData { containerId: string; pastEvents: any[]; }

export function JourneySearch({ locale }: { locale: Locale }) {
  const [mode, setMode] = useState<SearchMode>("sn");
  const [view, setView] = useState<ViewMode>("plan");
  const [input, setInput] = useState("");
  const [workOrderInput, setWorkOrderInput] = useState("");
  const [snPlan, setSnPlan] = useState<SnPlanData | null>(null);
  const [snActual, setSnActual] = useState<SnActualData | null>(null);
  const [boxPlan, setBoxPlan] = useState<BoxPlanData | null>(null);
  const [boxActual, setBoxActual] = useState<BoxActualData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function handleSearch() {
    if (!input.trim()) return;
    setLoading(true);
    setError("");
    setSnPlan(null); setSnActual(null); setBoxPlan(null); setBoxActual(null);

    if (mode === "sn") {
      Promise.all([
        apiClient.get<SnPlanData>(`/api/journey/plan/sn/${encodeURIComponent(input.trim())}?workOrderCode=${encodeURIComponent(workOrderInput.trim())}`),
        mesApi.getSnJourney(input.trim()),
      ]).then(([planRes, actualRes]: any[]) => {
        setSnPlan(planRes); setSnActual(actualRes); setLoading(false);
      }).catch(() => { setError("SN未找到或无工艺路线"); setLoading(false); });
    } else {
      Promise.all([
        apiClient.get<BoxPlanData>(`/api/journey/plan/box/${encodeURIComponent(input.trim())}?workOrderCode=${encodeURIComponent(workOrderInput.trim())}`),
        mesApi.getBoxJourney(input.trim()),
      ]).then(([planRes, actualRes]: any[]) => {
        setBoxPlan(planRes); setBoxActual(actualRes); setLoading(false);
      }).catch(() => { setError("箱未找到"); setLoading(false); });
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) { if (e.key === "Enter") handleSearch(); }

  return (
    <div className="screen-stack">
      {/* Search bar */}
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2>产品履历 / Journey Trace</h2>
            <p>计划履历 vs 实际履历对比</p>
          </div>
        </div>
        <div className="toolbar" style={{ marginTop: 12 }}>
          <button type="button" className={`action-button ${mode === "sn" ? "active" : ""}`} onClick={() => setMode("sn")}>
            <Package size={16} /> SN履历
          </button>
          <button type="button" className={`action-button ${mode === "container" ? "active" : ""}`} onClick={() => setMode("container")}>
            <Truck size={16} /> 箱履历
          </button>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <div className="scanner" style={{ flex: 1 }}>
            <input type="text" className="input" placeholder={mode === "sn" ? "输入SN号..." : "输入箱号..."} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={handleKeyDown} />
          </div>
          {mode === "sn" && (
            <div className="scanner" style={{ width: 200 }}>
              <input type="text" className="input" placeholder="工单号(可选)" value={workOrderInput} onChange={(e) => setWorkOrderInput(e.target.value)} onKeyDown={handleKeyDown} />
            </div>
          )}
          <button type="button" className="action-button primary" onClick={handleSearch} disabled={loading}>
            {loading ? <Clock size={16} className="spin" /> : <Search size={16} />}查询
          </button>
        </div>
        {error && <div style={{ marginTop: 12, color: "var(--danger)", display: "flex", alignItems: "center", gap: 6 }}><AlertCircle size={16} /> {error}</div>}
      </section>

      {/* SN Journey Result */}
      {(snPlan || snActual) && (
        <section className="surface-panel">
          <div className="section-header">
            <h2>SN: {snPlan?.sn || snActual?.sn}</h2>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className={`action-button ${view === "plan" ? "active" : ""}`} onClick={() => setView("plan")}><Map size={16} /> 计划履历</button>
              <button type="button" className={`action-button ${view === "actual" ? "active" : ""}`} onClick={() => setView("actual")}><List size={16} /> 实际履历</button>
            </div>
          </div>

          {view === "plan" && snPlan && (
            <div style={{ marginTop: 16 }}>
              <div style={{ marginBottom: 12, fontSize: 13, color: "var(--text-secondary)" }}>工单: {snPlan.workOrderCode || "—"} | 产品: {snPlan.productCode || "—"} | 共 {snPlan.totalSteps} 个计划节点</div>
              <div style={{ overflowX: "auto" }}>
                <table className="data-table">
                  <thead><tr><th>#</th><th>工站类型</th><th>工站代码</th><th>工站名称</th><th>需扫描</th><th>分叉/退出</th><th>说明</th></tr></thead>
                  <tbody>{snPlan.planNodes.map((node: any, i: number) => <PlanNodeRow key={i} node={node} isLast={i === snPlan.planNodes.length - 1} />)}</tbody>
                </table>
              </div>
            </div>
          )}

          {view === "actual" && snActual && (
            <div style={{ marginTop: 16 }}>
              {snActual.ngDefectRecords.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <h3 style={{ fontSize: 14, color: "var(--danger)", marginBottom: 8 }}><AlertCircle size={16} style={{ marginRight: 6 }} /> NG记录 ({snActual.ngDefectRecords.length})</h3>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
                    {snActual.ngDefectRecords.map((ng: any, i: number) => (
                      <div key={i} className="card" style={{ borderLeft: "3px solid var(--danger)" }}>
                        <div style={{ fontWeight: 600 }}>{ng.defectCode}</div>
                        <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{ng.stationCode}</div>
                        <div style={{ fontSize: 12 }}>{ng.defectDescription || "—"}</div>
                        <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>{ng.createdAt ? new Date(ng.createdAt).toLocaleString() : "—"}</div>
                        <div style={{ marginTop: 4 }}><span className={`badge ${ng.repairStatus === "repaired" ? "badge-success" : "badge-danger"}`}>{ng.repairStatus || "pending"}</span></div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {snActual.repairWorkOrders.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <h3 style={{ fontSize: 14, color: "var(--warn)", marginBottom: 8 }}><CheckCircle size={16} style={{ marginRight: 6 }} /> 维修工单 ({snActual.repairWorkOrders.length})</h3>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
                    {snActual.repairWorkOrders.map((wo: any, i: number) => (
                      <div key={i} className="card" style={{ borderLeft: "3px solid var(--warn)" }}>
                        <div style={{ fontWeight: 600 }}>{wo.workOrderNo}</div>
                        <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{wo.sourceStation}</div>
                        <div style={{ fontSize: 12 }}>状态: {wo.status}</div>
                        <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>{wo.repairCompletedAt ? `完成: ${new Date(wo.repairCompletedAt).toLocaleString()}` : "未完成"}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div style={{ overflowX: "auto" }}>
                <table className="data-table">
                  <thead><tr><th>事件类型</th><th>阶段</th><th>工站代码</th><th>工站名称</th><th>结果</th><th>不良代码</th><th>操作员</th><th>时间</th></tr></thead>
                  <tbody>{snActual.pastEvents.map((event: any, i: number) => <SnActualRow key={i} event={event} />)}</tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Box Journey Result */}
      {(boxPlan || boxActual) && (
        <section className="surface-panel">
          <div className="section-header">
            <h2>箱号: {boxPlan?.containerId || boxActual?.containerId}</h2>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className={`action-button ${view === "plan" ? "active" : ""}`} onClick={() => setView("plan")}><Map size={16} /> 计划履历</button>
              <button type="button" className={`action-button ${view === "actual" ? "active" : ""}`} onClick={() => setView("actual")}><List size={16} /> 实际履历</button>
            </div>
          </div>

          {view === "plan" && boxPlan && (
            <div style={{ marginTop: 16 }}>
              <div style={{ marginBottom: 12, fontSize: 13, color: "var(--text-secondary)" }}>工单: {boxPlan.workOrderCode || "—"} | 共 {boxPlan.totalSteps} 个计划节点</div>
              <div style={{ overflowX: "auto" }}>
                <table className="data-table">
                  <thead><tr><th>#</th><th>事件类型</th><th>阶段</th><th>位置代码</th><th>位置名称</th><th>说明</th><th>分叉/退出</th></tr></thead>
                  <tbody>{boxPlan.planNodes.map((node: any, i: number) => <PlanNodeRow key={i} node={node} isLast={i === boxPlan.planNodes.length - 1} />)}</tbody>
                </table>
              </div>
            </div>
          )}

          {view === "actual" && boxActual && (
            <div style={{ marginTop: 16 }}>
              <div style={{ overflowX: "auto" }}>
                <table className="data-table">
                  <thead><tr><th>事件类型</th><th>阶段</th><th>当前位置</th><th>位置名称</th><th>下一位置</th><th>下一位置名称</th><th>操作员</th><th>时间</th></tr></thead>
                  <tbody>{boxActual.pastEvents.map((event: any, i: number) => <BoxActualRow key={i} event={event} />)}</tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Legend */}
      <section className="surface-panel">
        <h3 style={{ fontSize: 14, marginBottom: 12 }}>事件类型图例</h3>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          {Object.entries(eventTypeColors).map(([type, color]) => (
            <div key={type} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 12, height: 12, borderRadius: 2, background: color }} />
              <span style={{ fontSize: 12 }}>{type}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
