import { useState, useEffect, useCallback } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { maintenanceApi } from "../api";
import type { WorkOrder, EquipmentAsset, FaultCodeCategory, WorkOrderStats, MtbfMttrRow } from "../api/maintenance";

interface Props { locale: Locale; }

const URGENCY_MAP: Record<string, { label: string; cls: string; color: string }> = {
  line_down: { label: "停线", cls: "badge-danger", color: "#ef4444" },
  speed_reduced: { label: "降速", cls: "badge-warning", color: "#f59e0b" },
  can_continue: { label: "可继续", cls: "badge-info", color: "#3b82f6" },
  planned: { label: "计划", cls: "badge-muted", color: "#6b7280" },
};
const PRIORITY_MAP: Record<string, { label: string; cls: string }> = {
  high: { label: "高", cls: "badge-danger" }, medium: { label: "中", cls: "badge-warning" }, low: { label: "低", cls: "badge-muted" },
};
const WO_STATUS_MAP: Record<string, { label: string; cls: string }> = {
  waiting_to_process: { label: "待处理", cls: "badge-warning" },
  received: { label: "已接单", cls: "badge-info" },
  in_processing: { label: "维修中", cls: "badge-info" },
  completed: { label: "已完成", cls: "badge-ok" },
  fixed: { label: "已验证", cls: "badge-ok" },
  closed: { label: "已关闭", cls: "badge-muted" },
};
const WO_FLOW = ["waiting_to_process", "received", "in_processing", "completed", "fixed", "closed"];

type ViewMode = "list" | "stats" | "create" | "detail";

export function MaintenanceWorkOrders({ locale }: Props) {
  const [view, setView] = useState<ViewMode>("list");
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("all");
  const [urgencyFilter, setUrgencyFilter] = useState("all");
  const [selectedWO, setSelectedWO] = useState<WorkOrder | null>(null);
  const [stats, setStats] = useState<{ summary: WorkOrderStats; mtbf_mttr: MtbfMttrRow[]; fault_pareto: Array<{ category: string; cnt: number }> } | null>(null);
  const [assets, setAssets] = useState<EquipmentAsset[]>([]);
  const [faultTree, setFaultTree] = useState<FaultCodeCategory[]>([]);
  const limit = 30;

  // Create form
  const [form, setForm] = useState({
    equipmentId: "", faultDescription: "", faultCategory: "mechanical",
    priority: "medium", urgencyLevel: "can_continue", woType: "corrective",
    faultCodeId: "", issuePerson: "", issuePhone: "",
  });
  // Complete form
  const [completeForm, setCompleteForm] = useState({
    realCause: "", resolutionNotes: "", rootCauseCategory: "",
    downtimeMinutes: 0, repairCostLabor: 0, repairCostParts: 0, repairCostExternal: 0,
    isExternalRepair: false, externalVendor: "", trialPieces: 0,
  });

  const fetchOrders = useCallback(() => {
    setLoading(true);
    maintenanceApi.getWorkOrders({
      status: statusFilter === "all" ? undefined : statusFilter,
      urgency: urgencyFilter === "all" ? undefined : urgencyFilter,
      page, limit,
    }).then((res: any) => {
      const d = res?.data ?? res;
      setOrders(Array.isArray(d) ? d : d?.data ?? []);
      setTotal(d?.total ?? 0);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [statusFilter, urgencyFilter, page]);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  useEffect(() => {
    maintenanceApi.getAssets({ limit: 200 }).then((r: any) => setAssets(r?.data ?? [])).catch(() => {});
    maintenanceApi.getFaultCodes().then((r: any) => setFaultTree(r?.data ?? [])).catch(() => {});
  }, []);

  const fetchStats = useCallback(() => {
    maintenanceApi.getWorkOrderStats({ days: 90 }).then((r: any) => setStats(r)).catch(() => {});
  }, []);
  useEffect(() => { if (view === "stats") fetchStats(); }, [view, fetchStats]);

  const openDetail = (wo: WorkOrder) => {
    maintenanceApi.getWorkOrderById(wo.id).then((r: any) => {
      setSelectedWO(r?.data ?? wo);
      setView("detail");
    }).catch(() => { setSelectedWO(wo); setView("detail"); });
  };

  const createWO = () => {
    if (!form.equipmentId || !form.faultDescription) return;
    const asset = assets.find(a => a.id === form.equipmentId);
    maintenanceApi.createWorkOrder({
      ...form,
      equipmentCode: asset?.asset_code,
      equipmentNameZh: asset?.name_zh,
      lineId: asset?.line_id,
    }).then(() => {
      setView("list");
      setForm({ equipmentId: "", faultDescription: "", faultCategory: "mechanical", priority: "medium", urgencyLevel: "can_continue", woType: "corrective", faultCodeId: "", issuePerson: "", issuePhone: "" });
      fetchOrders();
    }).catch(() => {});
  };

  const doAction = (action: string) => {
    if (!selectedWO) return;
    const id = selectedWO.id;
    let p: Promise<any>;
    if (action === "assign") p = maintenanceApi.assignWorkOrder(id, prompt("指派技术员:") ?? "");
    else if (action === "start") p = maintenanceApi.startWorkOrder(id);
    else if (action === "complete") p = maintenanceApi.completeWorkOrder(id, completeForm);
    else if (action === "verify") p = maintenanceApi.verifyWorkOrder(id, { verificationResult: "pass" });
    else if (action === "escalate") p = maintenanceApi.escalateWorkOrder(id, prompt("升级至:") ?? "");
    else return;
    p.then((r: any) => {
      setSelectedWO(r?.data ?? selectedWO);
      fetchOrders();
    }).catch(() => {});
  };

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const allFaultCodes = faultTree.flatMap(cat => cat.children.flatMap(sub => sub.items.map(item => ({ ...item, path: `${cat.name} > ${sub.name} > ${item.name_zh}` }))));

  // ── Stats View ──
  if (view === "stats") {
    return (
      <div className="screen-stack">
        <div className="surface-panel">
          <div className="section-header">
            <div><h2>维修统计分析</h2><p style={{ fontSize: 12, color: "var(--muted)" }}>MTBF / MTTR / 成本 / 故障帕累托 (90天)</p></div>
            <button className="btn btn-sm" onClick={() => setView("list")}>← 返回工单列表</button>
          </div>
        </div>
        {stats && (
          <>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {[
                { label: "已完成工单", value: stats.summary.total_completed, icon: "✅" },
                { label: "开放工单", value: stats.summary.total_open, icon: "📋" },
                { label: "平均停机(min)", value: stats.summary.avg_downtime ? Math.round(Number(stats.summary.avg_downtime)) : "-", icon: "⏱️" },
                { label: "维修总成本(USD)", value: stats.summary.total_cost ? Math.round(Number(stats.summary.total_cost)).toLocaleString() : "-", icon: "💰" },
                { label: "停线次数", value: stats.summary.line_down_count, icon: "🔴" },
                { label: "SLA违约", value: stats.summary.sla_breached_count, icon: "⚠️" },
              ].map((c, i) => (
                <div key={i} className="surface-panel" style={{ padding: "12px 16px", flex: 1, minWidth: 130 }}>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>{c.icon} {c.label}</div>
                  <div style={{ fontSize: 22, fontWeight: 700 }}>{c.value}</div>
                </div>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
              <section className="surface-panel" style={{ padding: 16 }}>
                <h3 style={{ fontSize: 13, marginBottom: 8 }}>设备 MTBF / MTTR</h3>
                <div className="table-shell"><table>
                  <thead><tr><th>设备</th><th>维修次数</th><th>MTTR(min)</th><th>MTBF(h)</th><th>总成本</th></tr></thead>
                  <tbody>
                    {stats.mtbf_mttr.map((r, i) => (
                      <tr key={i}>
                        <td style={{ fontSize: 12 }}>{r.asset_code} {r.name_zh}</td>
                        <td style={{ textAlign: "center" }}>{r.repair_count}</td>
                        <td style={{ textAlign: "right" }}>{r.mttr_minutes ? Math.round(Number(r.mttr_minutes)) : "-"}</td>
                        <td style={{ textAlign: "right" }}>{r.mtbf_hours ?? "-"}</td>
                        <td style={{ textAlign: "right" }}>{r.total_cost ? `$${Math.round(Number(r.total_cost)).toLocaleString()}` : "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              </section>
              <section className="surface-panel" style={{ padding: 16 }}>
                <h3 style={{ fontSize: 13, marginBottom: 8 }}>故障帕累托</h3>
                {stats.fault_pareto.map((f, i) => {
                  const maxCnt = Math.max(...stats.fault_pareto.map(x => x.cnt), 1);
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                      <span style={{ fontSize: 11, width: 60, textAlign: "right", color: "var(--muted)" }}>{f.category}</span>
                      <div style={{ flex: 1, height: 16, background: "var(--border)", borderRadius: 3, overflow: "hidden" }}>
                        <div style={{ width: `${(f.cnt / maxCnt) * 100}%`, height: "100%", background: i === 0 ? "#ef4444" : i === 1 ? "#f59e0b" : "#3b82f6", borderRadius: 3 }} />
                      </div>
                      <span style={{ fontSize: 11, width: 24 }}>{f.cnt}</span>
                    </div>
                  );
                })}
                {stats.fault_pareto.length === 0 && <div style={{ textAlign: "center", color: "var(--muted)", padding: 16, fontSize: 12 }}>暂无数据</div>}
              </section>
            </div>
          </>
        )}
      </div>
    );
  }

  // ── Create View ──
  if (view === "create") {
    const inputStyle = { width: "100%", padding: "6px 10px", borderRadius: 4, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 13 } as const;
    return (
      <div className="screen-stack">
        <div className="surface-panel">
          <div className="section-header">
            <div><h2>报修 / 新建工单</h2></div>
            <button className="btn btn-sm" onClick={() => setView("list")}>← 返回</button>
          </div>
        </div>
        <section className="surface-panel" style={{ padding: 20, maxWidth: 640 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>设备 *</label>
              <select value={form.equipmentId} onChange={e => setForm(f => ({ ...f, equipmentId: e.target.value }))} style={inputStyle}>
                <option value="">选择设备...</option>
                {assets.map(a => <option key={a.id} value={a.id}>{a.asset_code} - {a.name_zh} ({a.line_code ?? ""})</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>故障描述 *</label>
              <textarea value={form.faultDescription} onChange={e => setForm(f => ({ ...f, faultDescription: e.target.value }))}
                rows={3} style={{ ...inputStyle, resize: "vertical" }} placeholder="描述故障现象..." />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>紧急程度</label>
                <select value={form.urgencyLevel} onChange={e => setForm(f => ({ ...f, urgencyLevel: e.target.value }))} style={inputStyle}>
                  {Object.entries(URGENCY_MAP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>优先级</label>
                <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))} style={inputStyle}>
                  {Object.entries(PRIORITY_MAP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>工单类型</label>
                <select value={form.woType} onChange={e => setForm(f => ({ ...f, woType: e.target.value }))} style={inputStyle}>
                  <option value="corrective">故障维修</option>
                  <option value="preventive">预防维修</option>
                  <option value="emergency">紧急抢修</option>
                  <option value="external">外修</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>故障分类</label>
                <select value={form.faultCategory} onChange={e => setForm(f => ({ ...f, faultCategory: e.target.value }))} style={inputStyle}>
                  <option value="mechanical">机械</option><option value="electrical">电气</option>
                  <option value="software">软件</option><option value="pneumatic">气动</option>
                  <option value="hydraulic">液压</option><option value="other">其他</option>
                </select>
              </div>
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>故障代码 (三级)</label>
              <select value={form.faultCodeId} onChange={e => setForm(f => ({ ...f, faultCodeId: e.target.value }))} style={inputStyle}>
                <option value="">选择故障代码...</option>
                {allFaultCodes.map(fc => <option key={fc.id} value={fc.id}>{fc.path}</option>)}
              </select>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>报修人</label>
                <input value={form.issuePerson} onChange={e => setForm(f => ({ ...f, issuePerson: e.target.value }))} style={inputStyle} placeholder="姓名" />
              </div>
              <div>
                <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>联系电话</label>
                <input value={form.issuePhone} onChange={e => setForm(f => ({ ...f, issuePhone: e.target.value }))} style={inputStyle} placeholder="电话" />
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
              <button className="btn btn-sm" onClick={() => setView("list")}>取消</button>
              <button className="btn btn-sm btn-primary" onClick={createWO} disabled={!form.equipmentId || !form.faultDescription}>提交工单</button>
            </div>
          </div>
        </section>
      </div>
    );
  }

  // ── Detail View ──
  if (view === "detail" && selectedWO) {
    const wo = selectedWO;
    const st = WO_STATUS_MAP[wo.status] ?? { label: wo.status, cls: "badge-muted" };
    const urg = URGENCY_MAP[wo.urgency_level] ?? { label: wo.urgency_level, cls: "badge-muted", color: "#666" };
    const pri = PRIORITY_MAP[wo.priority] ?? { label: wo.priority, cls: "badge-muted" };
    const flowIdx = WO_FLOW.indexOf(wo.status);
    const inputStyle = { width: "100%", padding: "6px 10px", borderRadius: 4, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 13 } as const;

    return (
      <div className="screen-stack">
        <div className="surface-panel" style={{ padding: "16px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
            <button className="btn btn-sm" onClick={() => { setView("list"); setSelectedWO(null); }}>← 返回</button>
            <h2 style={{ margin: 0, fontSize: 16, fontFamily: "monospace" }}>{wo.wo_no}</h2>
            <span className={`badge ${st.cls}`}>{st.label}</span>
            <span className={`badge ${urg.cls}`}>{urg.label}</span>
            <span className={`badge ${pri.cls}`}>优先级:{pri.label}</span>
          </div>
          {/* Flow Progress */}
          <div style={{ display: "flex", gap: 4, alignItems: "center", marginTop: 8 }}>
            {WO_FLOW.map((s, i) => (
              <div key={s} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <div style={{
                  padding: "3px 10px", borderRadius: 12, fontSize: 10, fontWeight: i <= flowIdx ? 600 : 400,
                  background: i < flowIdx ? "#22c55e" : i === flowIdx ? "var(--primary)" : "var(--border)",
                  color: i <= flowIdx ? "#fff" : "var(--muted)",
                }}>{WO_STATUS_MAP[s]?.label ?? s}</div>
                {i < WO_FLOW.length - 1 && <span style={{ color: i < flowIdx ? "#22c55e" : "var(--border)", fontSize: 10 }}>→</span>}
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <section className="surface-panel" style={{ padding: 16 }}>
            <h3 style={{ fontSize: 13, marginBottom: 10 }}>📋 工单信息</h3>
            {[
              ["设备", `${wo.equipment_code ?? ""} ${wo.equipment_name ?? wo.equipment_name_zh ?? ""}`],
              ["产线", wo.line_name ?? "-"],
              ["故障描述", wo.fault_description],
              ["故障代码", wo.fault_code_path ?? wo.fault_code_name ?? "-"],
              ["典型原因", wo.typical_cause ?? "-"],
              ["典型对策", wo.typical_fix ?? "-"],
              ["报修人", wo.issue_person ?? "-"],
              ["报修时间", wo.issue_time ? new Date(wo.issue_time).toLocaleString("zh-CN") : "-"],
              ["指派技术员", wo.assigned_technician ?? "未指派"],
              ["响应截止", wo.response_deadline ? new Date(wo.response_deadline).toLocaleString("zh-CN") : "-"],
            ].map(([l, v], i) => (
              <div key={i} style={{ display: "flex", padding: "4px 0", borderBottom: "1px solid var(--border)", fontSize: 12 }}>
                <span style={{ width: 90, color: "var(--muted)", flexShrink: 0 }}>{l}</span>
                <span style={{ flex: 1 }}>{v}</span>
              </div>
            ))}
          </section>

          <section className="surface-panel" style={{ padding: 16 }}>
            <h3 style={{ fontSize: 13, marginBottom: 10 }}>🔧 维修结果</h3>
            {wo.status === "completed" || wo.status === "fixed" || wo.status === "closed" ? (
              <>
                {[
                  ["真实原因", wo.real_cause ?? "-"],
                  ["解决措施", wo.resolution_notes ?? "-"],
                  ["根因分类", wo.root_cause_category ?? "-"],
                  ["停机时间", wo.downtime_minutes ? `${wo.downtime_minutes} min` : "-"],
                  ["人工费", wo.repair_cost_labor ? `$${wo.repair_cost_labor}` : "-"],
                  ["备件费", wo.repair_cost_parts ? `$${wo.repair_cost_parts}` : "-"],
                  ["外修费", wo.repair_cost_external ? `$${wo.repair_cost_external}` : "-"],
                  ["总费用", wo.repair_cost_total ? `$${wo.repair_cost_total}` : "-"],
                  ["外修", wo.is_external_repair ? `是 (${wo.external_vendor ?? ""})` : "否"],
                  ["试产数量", wo.trial_pieces ?? "-"],
                  ["验证结果", wo.verification_result ?? "-"],
                  ["验证人", wo.verified_by ?? "-"],
                ].map(([l, v], i) => (
                  <div key={i} style={{ display: "flex", padding: "4px 0", borderBottom: "1px solid var(--border)", fontSize: 12 }}>
                    <span style={{ width: 90, color: "var(--muted)", flexShrink: 0 }}>{l}</span>
                    <span style={{ flex: 1 }}>{v}</span>
                  </div>
                ))}
              </>
            ) : (
              <div style={{ fontSize: 12, color: "var(--muted)", padding: 12 }}>维修尚未完成</div>
            )}

            {/* Action Buttons */}
            <h3 style={{ fontSize: 13, margin: "16px 0 10px" }}>⚡ 操作</h3>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {wo.status === "waiting_to_process" && (
                <button className="btn btn-sm btn-primary" onClick={() => doAction("assign")}>指派技术员</button>
              )}
              {wo.status === "received" && (
                <button className="btn btn-sm btn-primary" onClick={() => doAction("start")}>开始维修</button>
              )}
              {wo.status === "in_processing" && (
                <button className="btn btn-sm btn-primary" onClick={() => doAction("complete")}>完成维修</button>
              )}
              {wo.status === "completed" && (
                <button className="btn btn-sm btn-primary" onClick={() => doAction("verify")}>验证通过</button>
              )}
              {!["fixed", "closed"].includes(wo.status) && (
                <button className="btn btn-sm" style={{ color: "#ef4444" }} onClick={() => doAction("escalate")}>升级</button>
              )}
            </div>

            {/* Complete Form (inline when in_processing) */}
            {wo.status === "in_processing" && (
              <div style={{ marginTop: 12, padding: 12, border: "1px solid var(--border)", borderRadius: 6 }}>
                <h4 style={{ fontSize: 12, marginBottom: 8 }}>填写维修结果</h4>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <input placeholder="真实原因" value={completeForm.realCause} onChange={e => setCompleteForm(f => ({ ...f, realCause: e.target.value }))} style={inputStyle} />
                  <textarea placeholder="解决措施" rows={2} value={completeForm.resolutionNotes} onChange={e => setCompleteForm(f => ({ ...f, resolutionNotes: e.target.value }))} style={{ ...inputStyle, resize: "vertical" }} />
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                    <input type="number" placeholder="停机(min)" value={completeForm.downtimeMinutes || ""} onChange={e => setCompleteForm(f => ({ ...f, downtimeMinutes: Number(e.target.value) }))} style={inputStyle} />
                    <input type="number" placeholder="人工费($)" value={completeForm.repairCostLabor || ""} onChange={e => setCompleteForm(f => ({ ...f, repairCostLabor: Number(e.target.value) }))} style={inputStyle} />
                    <input type="number" placeholder="备件费($)" value={completeForm.repairCostParts || ""} onChange={e => setCompleteForm(f => ({ ...f, repairCostParts: Number(e.target.value) }))} style={inputStyle} />
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <label style={{ fontSize: 12, display: "flex", gap: 4, alignItems: "center" }}>
                      <input type="checkbox" checked={completeForm.isExternalRepair} onChange={e => setCompleteForm(f => ({ ...f, isExternalRepair: e.target.checked }))} /> 外修
                    </label>
                    {completeForm.isExternalRepair && (
                      <input placeholder="外修供应商" value={completeForm.externalVendor} onChange={e => setCompleteForm(f => ({ ...f, externalVendor: e.target.value }))} style={{ ...inputStyle, flex: 1 }} />
                    )}
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    );
  }

  // ── List View (default) ──
  return (
    <div className="screen-stack">
      <div className="surface-panel">
        <div className="section-header">
          <div>
            <h2>维修工单</h2>
            <p style={{ fontSize: 12, color: "var(--muted)" }}>{total} 条工单</p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-sm" onClick={() => setView("stats")}>📊 统计分析</button>
            <button className="btn btn-sm btn-primary" onClick={() => setView("create")}>+ 报修</button>
          </div>
        </div>
        <div className="filter-row" style={{ display: "flex", gap: 8, padding: "4px 16px", alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>状态:</span>
          {["all", ...WO_FLOW].map(s => (
            <button key={s} className={`badge ${statusFilter === s ? "badge-info" : "badge-muted"}`}
              style={{ cursor: "pointer", border: "none", fontSize: 11, padding: "2px 8px" }}
              onClick={() => { setStatusFilter(s); setPage(1); }}>
              {s === "all" ? "全部" : WO_STATUS_MAP[s]?.label ?? s}
            </button>
          ))}
          <span style={{ fontSize: 12, color: "var(--muted)", marginLeft: 12 }}>紧急:</span>
          {["all", "line_down", "speed_reduced", "can_continue", "planned"].map(u => (
            <button key={u} className={`badge ${urgencyFilter === u ? "badge-info" : "badge-muted"}`}
              style={{ cursor: "pointer", border: "none", fontSize: 11, padding: "2px 8px" }}
              onClick={() => { setUrgencyFilter(u); setPage(1); }}>
              {u === "all" ? "全部" : URGENCY_MAP[u]?.label ?? u}
            </button>
          ))}
        </div>
      </div>

      <section className="surface-panel">
        {loading ? (
          <div className="table-shell"><table><thead><tr>{["工单号","设备","故障","紧急","状态","时间"].map(h => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>{[1,2,3,4,5].map(i => <tr key={i}>{[80,100,150,40,60,80].map((w,j) => <td key={j}><div className="skeleton" style={{height:14,width:w}}/></td>)}</tr>)}</tbody></table></div>
        ) : (
          <div className="table-shell"><table>
            <thead><tr>
              <th>工单号</th><th>设备</th><th>故障描述</th><th>故障代码</th>
              <th>紧急度</th><th>优先级</th><th>技术员</th><th>状态</th><th>报修时间</th>
            </tr></thead>
            <tbody>
              {orders.map(wo => {
                const st = WO_STATUS_MAP[wo.status] ?? { label: wo.status, cls: "badge-muted" };
                const urg = URGENCY_MAP[wo.urgency_level] ?? { label: wo.urgency_level, cls: "badge-muted", color: "#666" };
                const pri = PRIORITY_MAP[wo.priority] ?? { label: wo.priority, cls: "badge-muted" };
                return (
                  <tr key={wo.id} style={{ cursor: "pointer" }} onClick={() => openDetail(wo)}>
                    <td style={{ fontFamily: "monospace", fontSize: 11 }}>{wo.wo_no}</td>
                    <td style={{ fontSize: 12 }}>
                      <div>{wo.equipment_name ?? wo.equipment_name_zh ?? "-"}</div>
                      <div style={{ fontSize: 10, color: "var(--muted)" }}>{wo.equipment_code}</div>
                    </td>
                    <td style={{ fontSize: 12, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{wo.fault_description}</td>
                    <td style={{ fontSize: 11, color: "var(--muted)" }}>{wo.fault_code_name ?? "-"}</td>
                    <td><span className={`badge ${urg.cls}`} style={{ fontSize: 10 }}>{urg.label}</span></td>
                    <td><span className={`badge ${pri.cls}`} style={{ fontSize: 10 }}>{pri.label}</span></td>
                    <td style={{ fontSize: 12 }}>{wo.assigned_technician ?? <span style={{ color: "var(--muted)" }}>未指派</span>}</td>
                    <td><span className={`badge ${st.cls}`}>{st.label}</span></td>
                    <td style={{ fontSize: 11, color: "var(--muted)" }}>{wo.issue_time ? new Date(wo.issue_time).toLocaleString("zh-CN") : "-"}</td>
                  </tr>
                );
              })}
              {orders.length === 0 && <tr><td colSpan={9} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>暂无工单</td></tr>}
            </tbody>
          </table></div>
        )}
        {totalPages > 1 && (
          <div style={{ display: "flex", justifyContent: "center", gap: 8, padding: "12px 0", alignItems: "center" }}>
            <button className="btn btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>‹</button>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>{page} / {totalPages}</span>
            <button className="btn btn-sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>›</button>
          </div>
        )}
      </section>
    </div>
  );
}
