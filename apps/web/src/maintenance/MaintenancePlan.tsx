import { useState, useEffect, useCallback } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { maintenanceApi } from "../api";
import type { PmTemplateEnhanced, PmTemplateTaskEnhanced, PmExecution, EquipmentAsset } from "../api/maintenance";

interface Props { locale: Locale; }

const PM_LEVELS = [
  { code: "L1", label: "日保", color: "#22c55e", desc: "每日点检/清洁/润滑" },
  { code: "L2", label: "周保", color: "#3b82f6", desc: "每周检查/调整/紧固" },
  { code: "L3", label: "月保", color: "#f59e0b", desc: "每月精度检查/更换易损件" },
  { code: "L4", label: "季保", color: "#f97316", desc: "季度全面检查/校准" },
  { code: "L5", label: "年保", color: "#ef4444", desc: "年度大修/全面翻新" },
];

const TRIGGER_LABELS: Record<string, string> = {
  calendar: "📅 日历触发", runtime: "⏱️ 运行时间触发", count: "🔢 计数触发", dual: "📅⏱️ 双触发",
};

const RESULT_MAP: Record<string, { label: string; cls: string }> = {
  pending: { label: "待执行", cls: "badge-muted" },
  in_progress: { label: "执行中", cls: "badge-info" },
  completed: { label: "已完成", cls: "badge-ok" },
  abnormal: { label: "异常", cls: "badge-danger" },
  overdue: { label: "逾期", cls: "badge-danger" },
  skipped: { label: "跳过", cls: "badge-muted" },
};

export function MaintenancePlan({ locale }: Props) {
  const [view, setView] = useState<"templates" | "executions">("templates");
  const [templates, setTemplates] = useState<PmTemplateEnhanced[]>([]);
  const [executions, setExecutions] = useState<PmExecution[]>([]);
  const [assets, setAssets] = useState<EquipmentAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [levelFilter, setLevelFilter] = useState("all");
  const [selectedTpl, setSelectedTpl] = useState<(PmTemplateEnhanced & { tasks?: PmTemplateTaskEnhanced[] }) | null>(null);
  const [showCreateExec, setShowCreateExec] = useState(false);
  const [execForm, setExecForm] = useState({ templateId: "", assetId: "", pmLevel: "L1" });

  const fetchTemplates = useCallback(() => {
    setLoading(true);
    maintenanceApi.getEquipmentPmTemplates({ level: levelFilter === "all" ? undefined : levelFilter })
      .then((res: any) => { setTemplates(res?.data ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [levelFilter]);

  const fetchExecutions = useCallback(() => {
    setLoading(true);
    maintenanceApi.getPmExecutions({ limit: 100 })
      .then((res: any) => { setExecutions(res?.data ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (view === "templates") fetchTemplates();
    else fetchExecutions();
  }, [view, fetchTemplates, fetchExecutions]);

  useEffect(() => {
    maintenanceApi.getAssets({ limit: 200 }).then((res: any) => {
      setAssets(res?.data ?? []);
    }).catch(() => {});
  }, []);

  const openTemplate = (tpl: PmTemplateEnhanced) => {
    maintenanceApi.getEquipmentPmTemplateById(tpl.id).then((res: any) => {
      setSelectedTpl(res?.data ?? tpl);
    }).catch(() => setSelectedTpl(tpl));
  };

  const createExecution = () => {
    if (!execForm.templateId || !execForm.assetId) return;
    maintenanceApi.createPmExecution({
      templateId: execForm.templateId,
      assetId: execForm.assetId,
      pmLevel: execForm.pmLevel,
      triggerType: "manual",
    }).then(() => {
      setShowCreateExec(false);
      setExecForm({ templateId: "", assetId: "", pmLevel: "L1" });
      fetchExecutions();
    }).catch(() => {});
  };

  return (
    <div className="screen-stack">
      {/* Header */}
      <div className="surface-panel">
        <div className="section-header">
          <div>
            <h2>保养计划管理</h2>
            <p style={{ fontSize: 12, color: "var(--muted)" }}>5级保养体系 · 日历/运行时间双触发</p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className={`btn btn-sm ${view === "templates" ? "btn-primary" : ""}`} onClick={() => setView("templates")}>PM模板</button>
            <button className={`btn btn-sm ${view === "executions" ? "btn-primary" : ""}`} onClick={() => setView("executions")}>执行记录</button>
            <button className="btn btn-sm btn-primary" onClick={() => setShowCreateExec(true)}>+ 新建保养</button>
          </div>
        </div>
        {view === "templates" && (
          <div className="filter-row" style={{ display: "flex", gap: 8, padding: "4px 16px", alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>级别:</span>
            <button className={`badge ${levelFilter === "all" ? "badge-info" : "badge-muted"}`} style={{ cursor: "pointer", border: "none", fontSize: 11 }} onClick={() => setLevelFilter("all")}>全部</button>
            {PM_LEVELS.map(l => (
              <button key={l.code} className={`badge ${levelFilter === l.code ? "badge-info" : "badge-muted"}`}
                style={{ cursor: "pointer", border: "none", fontSize: 11 }}
                onClick={() => setLevelFilter(l.code)}>
                {l.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* PM Level Legend */}
      {view === "templates" && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {PM_LEVELS.map(l => (
            <div key={l.code} className="surface-panel" style={{ padding: "8px 12px", flex: 1, minWidth: 120, borderLeft: `3px solid ${l.color}` }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: l.color }}>{l.code} {l.label}</div>
              <div style={{ fontSize: 10, color: "var(--muted)" }}>{l.desc}</div>
            </div>
          ))}
        </div>
      )}

      {/* Templates View */}
      {view === "templates" && (
        <section className="surface-panel">
          {loading ? <div style={{ padding: 24 }}><div className="skeleton" style={{ height: 200, width: "100%" }} /></div> : (
            <div className="table-shell"><table>
              <thead><tr>
                <th>模板编号</th><th>模板名称</th><th>级别</th><th>设备类别</th>
                <th>触发方式</th><th>周期</th><th>预计时长</th><th>任务数</th><th>首件验证</th><th>操作</th>
              </tr></thead>
              <tbody>
                {templates.map(tpl => {
                  const lv = PM_LEVELS.find(l => l.code === tpl.pm_level);
                  return (
                    <tr key={tpl.id}>
                      <td style={{ fontFamily: "monospace", fontSize: 11 }}>{tpl.template_code}</td>
                      <td style={{ fontWeight: 500 }}>{tpl.template_name_zh}</td>
                      <td><span className="badge" style={{ fontSize: 10, background: lv?.color ?? "#666", color: "#fff" }}>{tpl.pm_level} {lv?.label}</span></td>
                      <td style={{ fontSize: 12 }}>{tpl.category_name ?? "-"}</td>
                      <td style={{ fontSize: 11 }}>{TRIGGER_LABELS[tpl.trigger_type] ?? tpl.trigger_type}</td>
                      <td style={{ fontSize: 12 }}>
                        {tpl.trigger_type === "calendar" || tpl.trigger_type === "dual" ? `${tpl.calendar_interval_days ?? "-"}天` : ""}
                        {tpl.trigger_type === "dual" ? " / " : ""}
                        {tpl.trigger_type === "runtime" || tpl.trigger_type === "dual" ? `${tpl.runtime_interval_hours ?? "-"}h` : ""}
                        {tpl.trigger_type === "count" ? `${tpl.runtime_interval_count ?? "-"}次` : ""}
                      </td>
                      <td style={{ fontSize: 12, textAlign: "right" }}>{tpl.estimated_minutes ?? "-"}min</td>
                      <td style={{ textAlign: "center" }}>{tpl.task_count ?? 0}</td>
                      <td style={{ textAlign: "center" }}>{tpl.requires_first_article ? "✅" : "-"}</td>
                      <td><button className="btn btn-sm" style={{ fontSize: 11 }} onClick={() => openTemplate(tpl)}>查看任务</button></td>
                    </tr>
                  );
                })}
                {templates.length === 0 && <tr><td colSpan={10} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>暂无PM模板</td></tr>}
              </tbody>
            </table></div>
          )}
        </section>
      )}

      {/* Executions View */}
      {view === "executions" && (
        <section className="surface-panel">
          {loading ? <div style={{ padding: 24 }}><div className="skeleton" style={{ height: 200, width: "100%" }} /></div> : (
            <div className="table-shell"><table>
              <thead><tr>
                <th>执行编号</th><th>设备</th><th>PM模板</th><th>级别</th><th>触发</th>
                <th>计划日期</th><th>实际开始</th><th>执行人</th><th>结果</th>
              </tr></thead>
              <tbody>
                {executions.map(ex => {
                  const r = RESULT_MAP[ex.result] ?? { label: ex.result, cls: "badge-muted" };
                  const lv = PM_LEVELS.find(l => l.code === ex.pm_level);
                  return (
                    <tr key={ex.id}>
                      <td style={{ fontFamily: "monospace", fontSize: 11 }}>{ex.execution_no}</td>
                      <td style={{ fontSize: 12 }}>{ex.equipment_name ?? ex.asset_code ?? "-"}</td>
                      <td style={{ fontSize: 12 }}>{ex.template_name_zh ?? "-"}</td>
                      <td><span className="badge" style={{ fontSize: 10, background: lv?.color ?? "#666", color: "#fff" }}>{ex.pm_level}</span></td>
                      <td style={{ fontSize: 11 }}>{ex.trigger_type === "manual" ? "手动" : ex.trigger_type === "auto" ? "自动" : ex.trigger_type}</td>
                      <td style={{ fontSize: 12 }}>{ex.scheduled_date?.slice(0, 10)}</td>
                      <td style={{ fontSize: 11, color: "var(--muted)" }}>{ex.actual_start ? new Date(ex.actual_start).toLocaleString("zh-CN") : "-"}</td>
                      <td style={{ fontSize: 12 }}>{ex.executor_name ?? "-"}</td>
                      <td><span className={`badge ${r.cls}`}>{r.label}</span></td>
                    </tr>
                  );
                })}
                {executions.length === 0 && <tr><td colSpan={9} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>暂无执行记录</td></tr>}
              </tbody>
            </table></div>
          )}
        </section>
      )}

      {/* Template Detail Modal */}
      {selectedTpl && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}
          onClick={() => setSelectedTpl(null)}>
          <div className="surface-panel" style={{ width: 640, maxHeight: "80vh", overflow: "auto", padding: 20 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ fontSize: 15 }}>{selectedTpl.template_name_zh}</h3>
              <button className="btn btn-sm" onClick={() => setSelectedTpl(null)}>✕</button>
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>
              {selectedTpl.template_code} · {selectedTpl.pm_level} · {TRIGGER_LABELS[selectedTpl.trigger_type]} · {selectedTpl.estimated_minutes}min
            </div>
            {selectedTpl.description && <p style={{ fontSize: 12, marginBottom: 12 }}>{selectedTpl.description}</p>}
            <h4 style={{ fontSize: 13, marginBottom: 8 }}>保养任务清单 ({selectedTpl.tasks?.length ?? 0}项)</h4>
            <div className="table-shell"><table>
              <thead><tr><th>#</th><th>任务名称</th><th>作业标准</th><th>标准值</th><th>需拍照</th><th>需测量</th><th>关键</th></tr></thead>
              <tbody>
                {(selectedTpl.tasks ?? []).map(task => (
                  <tr key={task.id}>
                    <td style={{ textAlign: "center", fontSize: 11 }}>{task.task_no}</td>
                    <td style={{ fontSize: 12, fontWeight: 500 }}>{task.task_name_zh}</td>
                    <td style={{ fontSize: 11, color: "var(--muted)", maxWidth: 200 }}>{task.instruction ?? "-"}</td>
                    <td style={{ fontSize: 11, fontFamily: "monospace" }}>{task.standard_value ?? "-"}</td>
                    <td style={{ textAlign: "center" }}>{task.requires_photo ? "📷" : "-"}</td>
                    <td style={{ textAlign: "center" }}>{task.requires_measurement ? "📏" : "-"}</td>
                    <td style={{ textAlign: "center" }}>{task.is_critical ? "⭐" : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>
        </div>
      )}

      {/* Create Execution Modal */}
      {showCreateExec && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}
          onClick={() => setShowCreateExec(false)}>
          <div className="surface-panel" style={{ width: 420, padding: 20 }} onClick={e => e.stopPropagation()}>
            <h3 style={{ fontSize: 15, marginBottom: 16 }}>新建保养执行</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>PM模板</label>
                <select value={execForm.templateId} onChange={e => {
                  const tpl = templates.find(t => t.id === e.target.value);
                  setExecForm(f => ({ ...f, templateId: e.target.value, pmLevel: tpl?.pm_level ?? f.pmLevel }));
                }} style={{ width: "100%", padding: "6px 8px", borderRadius: 4, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 13 }}>
                  <option value="">选择模板...</option>
                  {templates.map(tpl => <option key={tpl.id} value={tpl.id}>{tpl.template_code} - {tpl.template_name_zh}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>设备</label>
                <select value={execForm.assetId} onChange={e => setExecForm(f => ({ ...f, assetId: e.target.value }))}
                  style={{ width: "100%", padding: "6px 8px", borderRadius: 4, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 13 }}>
                  <option value="">选择设备...</option>
                  {assets.map(a => <option key={a.id} value={a.id}>{a.asset_code} - {a.name_zh}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>保养级别</label>
                <select value={execForm.pmLevel} onChange={e => setExecForm(f => ({ ...f, pmLevel: e.target.value }))}
                  style={{ width: "100%", padding: "6px 8px", borderRadius: 4, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 13 }}>
                  {PM_LEVELS.map(l => <option key={l.code} value={l.code}>{l.code} {l.label}</option>)}
                </select>
              </div>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
                <button className="btn btn-sm" onClick={() => setShowCreateExec(false)}>取消</button>
                <button className="btn btn-sm btn-primary" onClick={createExecution} disabled={!execForm.templateId || !execForm.assetId}>开始保养</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
