import { useState, useEffect, useCallback } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { maintenanceApi } from "../api";
import type { EquipmentAsset, WorkOrder, PmTemplateEnhanced, PmExecution } from "../api/maintenance";

interface Props { locale: Locale; }

type PdaView = "home" | "scan" | "asset" | "report" | "pm" | "pmExec" | "myOrders";

export function EquipmentMobilePda({ locale }: Props) {
  const [view, setView] = useState<PdaView>("home");
  const [scanInput, setScanInput] = useState("");
  const [asset, setAsset] = useState<EquipmentAsset | null>(null);
  const [assets, setAssets] = useState<EquipmentAsset[]>([]);
  const [templates, setTemplates] = useState<PmTemplateEnhanced[]>([]);
  const [myOrders, setMyOrders] = useState<WorkOrder[]>([]);
  const [reportForm, setReportForm] = useState({ faultDescription: "", urgencyLevel: "can_continue", priority: "medium" });
  const [pmExec, setPmExec] = useState<PmExecution | null>(null);
  const [pmItems, setPmItems] = useState<Array<{ taskNo: number; taskName: string; result: string; measuredValue: string; notes: string }>>([]);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState("");

  useEffect(() => {
    maintenanceApi.getAssets({ limit: 200 }).then((r: any) => setAssets(r?.data ?? [])).catch(() => {});
    maintenanceApi.getEquipmentPmTemplates().then((r: any) => setTemplates(r?.data ?? [])).catch(() => {});
  }, []);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3000); };

  const handleScan = () => {
    const code = scanInput.trim();
    if (!code) return;
    const found = assets.find(a => a.asset_code === code || a.qr_code === code || a.serial_no === code);
    if (found) {
      setAsset(found);
      setView("asset");
      setScanInput("");
    } else {
      showToast(`未找到设备: ${code}`);
    }
  };

  const submitReport = () => {
    if (!asset || !reportForm.faultDescription) return;
    setSubmitting(true);
    maintenanceApi.createWorkOrder({
      equipmentId: asset.id,
      equipmentCode: asset.asset_code,
      equipmentNameZh: asset.name_zh,
      lineId: asset.line_id,
      faultDescription: reportForm.faultDescription,
      urgencyLevel: reportForm.urgencyLevel,
      priority: reportForm.priority,
      woType: "corrective",
    }).then(() => {
      setSubmitting(false);
      setReportForm({ faultDescription: "", urgencyLevel: "can_continue", priority: "medium" });
      showToast("✅ 工单已提交");
      setView("asset");
    }).catch(() => { setSubmitting(false); showToast("❌ 提交失败"); });
  };

  const startPm = (tpl: PmTemplateEnhanced) => {
    if (!asset) return;
    setSubmitting(true);
    maintenanceApi.createPmExecution({
      templateId: tpl.id,
      assetId: asset.id,
      pmLevel: tpl.pm_level,
      triggerType: "manual",
    }).then((r: any) => {
      const exec = r?.data;
      setPmExec(exec);
      // Load template tasks
      maintenanceApi.getEquipmentPmTemplateById(tpl.id).then((tr: any) => {
        const tasks = tr?.data?.tasks ?? [];
        setPmItems(tasks.map((t: any) => ({ taskNo: t.task_no, taskName: t.task_name_zh, result: "ok", measuredValue: "", notes: "" })));
      }).catch(() => {});
      setSubmitting(false);
      setView("pmExec");
    }).catch(() => { setSubmitting(false); showToast("❌ 创建失败"); });
  };

  const completePm = () => {
    if (!pmExec) return;
    setSubmitting(true);
    maintenanceApi.completePmExecution(pmExec.id, {
      items: pmItems.map(i => ({ taskNo: i.taskNo, result: i.result, measuredValue: i.measuredValue, notes: i.notes })),
    }).then(() => {
      setSubmitting(false);
      showToast("✅ 保养完成");
      setView("asset");
      setPmExec(null);
      setPmItems([]);
    }).catch(() => { setSubmitting(false); showToast("❌ 提交失败"); });
  };

  const btnStyle = (active?: boolean) => ({
    padding: "12px 16px", borderRadius: 10, border: "none", cursor: "pointer",
    fontSize: 14, fontWeight: 600, textAlign: "center" as const,
    background: active ? "#3b82f6" : "#1e293b", color: active ? "#fff" : "#94a3b8",
    flex: 1,
  });
  const inputStyle = {
    width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #334155",
    background: "#0f172a", color: "#e2e8f0", fontSize: 14, boxSizing: "border-box" as const,
  };

  return (
    <div style={{ background: "#0a0e17", minHeight: "100vh", color: "#e2e8f0", maxWidth: 480, margin: "0 auto", fontFamily: "system-ui, sans-serif", position: "relative" }}>
      {/* Toast */}
      {toast && (
        <div style={{ position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)", background: "#1e293b", color: "#e2e8f0", padding: "8px 20px", borderRadius: 8, fontSize: 13, zIndex: 100, boxShadow: "0 4px 12px rgba(0,0,0,0.4)" }}>
          {toast}
        </div>
      )}

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderBottom: "1px solid #1e293b", background: "#0f172a" }}>
        {view !== "home" && <button onClick={() => setView(asset ? "asset" : "home")} style={{ background: "none", border: "none", color: "#3b82f6", fontSize: 16, cursor: "pointer" }}>←</button>}
        <h1 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>🔧 设备PDA</h1>
        {asset && <span style={{ fontSize: 11, color: "#64748b", fontFamily: "monospace" }}>{asset.asset_code}</span>}
      </div>

      {/* Home */}
      {view === "home" && (
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ textAlign: "center", padding: "24px 0", color: "#64748b" }}>
            <div style={{ fontSize: 48, marginBottom: 8 }}>📱</div>
            <div style={{ fontSize: 14 }}>设备移动管理终端</div>
          </div>
          <button style={{ ...btnStyle(), padding: "16px", fontSize: 16 }} onClick={() => setView("scan")}>📷 扫码识别设备</button>
          <button style={btnStyle()} onClick={() => setView("myOrders")}>📋 我的工单</button>
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 8 }}>快速选择设备:</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              {assets.slice(0, 8).map(a => (
                <button key={a.id} onClick={() => { setAsset(a); setView("asset"); }} style={{
                  padding: "8px", borderRadius: 8, border: "1px solid #1e293b", background: "#111827",
                  color: "#e2e8f0", fontSize: 11, cursor: "pointer", textAlign: "left",
                }}>
                  <div style={{ fontFamily: "monospace", fontSize: 10, color: "#64748b" }}>{a.asset_code}</div>
                  <div style={{ fontWeight: 600 }}>{a.name_zh}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Scan */}
      {view === "scan" && (
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ textAlign: "center", padding: "32px 0" }}>
            <div style={{ fontSize: 64, marginBottom: 12 }}>📷</div>
            <div style={{ fontSize: 14, color: "#94a3b8" }}>扫描设备QR码或输入编号</div>
          </div>
          <input value={scanInput} onChange={e => setScanInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleScan()}
            placeholder="输入设备编号 / QR码 / 序列号..."
            style={{ ...inputStyle, fontSize: 16, textAlign: "center" }} autoFocus />
          <button style={{ ...btnStyle(true), padding: "14px" }} onClick={handleScan}>确认</button>
        </div>
      )}

      {/* Asset Detail */}
      {view === "asset" && asset && (
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ background: "#111827", borderRadius: 12, padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <h2 style={{ fontSize: 18, margin: 0 }}>{asset.name_zh}</h2>
              <span style={{
                padding: "3px 10px", borderRadius: 12, fontSize: 11, fontWeight: 600,
                background: asset.status === "fault" || asset.status === "repair" ? "#ef444422" : asset.status === "active" || asset.status === "online" ? "#22c55e22" : "#1e293b",
                color: asset.status === "fault" || asset.status === "repair" ? "#ef4444" : asset.status === "active" || asset.status === "online" ? "#22c55e" : "#94a3b8",
              }}>{asset.status}</span>
            </div>
            <div style={{ fontSize: 12, color: "#64748b", display: "flex", flexDirection: "column", gap: 4 }}>
              <span>编号: {asset.asset_code} | 类别: {asset.category_zh ?? "-"}</span>
              <span>产线: {asset.line_code ?? "-"} | 关键度: {asset.criticality}</span>
              <span>累计运行: {asset.cumulative_runtime_hours ? `${Number(asset.cumulative_runtime_hours).toLocaleString()}h` : "-"} | 维修: {asset.total_repair_count ?? 0}次</span>
            </div>
          </div>
          <button style={{ ...btnStyle(), background: "#ef444422", color: "#ef4444", padding: "14px" }} onClick={() => setView("report")}>🔴 报修</button>
          <button style={{ ...btnStyle(), background: "#22c55e22", color: "#22c55e", padding: "14px" }} onClick={() => setView("pm")}>🛡️ 保养</button>
          <button style={btnStyle()} onClick={() => setView("scan")}>📷 重新扫码</button>
        </div>
      )}

      {/* Report Fault */}
      {view === "report" && asset && (
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <h2 style={{ fontSize: 16, margin: 0 }}>🔴 报修 - {asset.name_zh}</h2>
          <textarea value={reportForm.faultDescription} onChange={e => setReportForm(f => ({ ...f, faultDescription: e.target.value }))}
            rows={4} placeholder="描述故障现象..." style={{ ...inputStyle, resize: "vertical" }} />
          <div>
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>紧急程度</div>
            <div style={{ display: "flex", gap: 6 }}>
              {[["line_down", "🔴 停线"], ["speed_reduced", "🟡 降速"], ["can_continue", "🟢 可继续"], ["planned", "⚪ 计划"]].map(([k, l]) => (
                <button key={k} onClick={() => setReportForm(f => ({ ...f, urgencyLevel: k }))} style={{
                  ...btnStyle(reportForm.urgencyLevel === k), padding: "8px 4px", fontSize: 11,
                }}>{l}</button>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>优先级</div>
            <div style={{ display: "flex", gap: 6 }}>
              {[["high", "高"], ["medium", "中"], ["low", "低"]].map(([k, l]) => (
                <button key={k} onClick={() => setReportForm(f => ({ ...f, priority: k }))} style={{
                  ...btnStyle(reportForm.priority === k), padding: "8px", fontSize: 12,
                }}>{l}</button>
              ))}
            </div>
          </div>
          <button style={{ ...btnStyle(true), padding: "14px" }} onClick={submitReport} disabled={submitting || !reportForm.faultDescription}>
            {submitting ? "提交中..." : "提交工单"}
          </button>
        </div>
      )}

      {/* PM Selection */}
      {view === "pm" && asset && (
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
          <h2 style={{ fontSize: 16, margin: "0 0 8px" }}>🛡️ 选择保养模板 - {asset.name_zh}</h2>
          {templates.map(tpl => (
            <button key={tpl.id} onClick={() => startPm(tpl)} disabled={submitting} style={{
              padding: "12px", borderRadius: 10, border: "1px solid #1e293b", background: "#111827",
              color: "#e2e8f0", cursor: "pointer", textAlign: "left",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{tpl.template_name_zh}</span>
                <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 8, background: "#1e293b", color: "#94a3b8" }}>{tpl.pm_level}</span>
              </div>
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>
                {tpl.estimated_minutes}min · {tpl.task_count ?? 0}项任务
              </div>
            </button>
          ))}
          {templates.length === 0 && <div style={{ textAlign: "center", color: "#64748b", padding: 24 }}>暂无PM模板</div>}
        </div>
      )}

      {/* PM Execution Checklist */}
      {view === "pmExec" && pmExec && (
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
          <h2 style={{ fontSize: 16, margin: "0 0 4px" }}>🛡️ 保养执行</h2>
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 8 }}>{pmExec.execution_no} · {asset?.name_zh}</div>
          {pmItems.map((item, idx) => (
            <div key={idx} style={{ background: "#111827", borderRadius: 10, padding: 12, border: "1px solid #1e293b" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{item.taskNo}. {item.taskName}</span>
                <div style={{ display: "flex", gap: 4 }}>
                  {["ok", "ng"].map(r => (
                    <button key={r} onClick={() => {
                      const newItems = [...pmItems];
                      newItems[idx] = { ...newItems[idx], result: r };
                      setPmItems(newItems);
                    }} style={{
                      padding: "4px 12px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 11, fontWeight: 600,
                      background: item.result === r ? (r === "ok" ? "#22c55e" : "#ef4444") : "#1e293b",
                      color: item.result === r ? "#fff" : "#64748b",
                    }}>{r === "ok" ? "✓ OK" : "✗ NG"}</button>
                  ))}
                </div>
              </div>
              <input placeholder="测量值 (可选)" value={item.measuredValue}
                onChange={e => { const ni = [...pmItems]; ni[idx] = { ...ni[idx], measuredValue: e.target.value }; setPmItems(ni); }}
                style={{ ...inputStyle, fontSize: 12, padding: "6px 10px", marginBottom: 4 }} />
              <input placeholder="备注 (可选)" value={item.notes}
                onChange={e => { const ni = [...pmItems]; ni[idx] = { ...ni[idx], notes: e.target.value }; setPmItems(ni); }}
                style={{ ...inputStyle, fontSize: 12, padding: "6px 10px" }} />
            </div>
          ))}
          <button style={{ ...btnStyle(true), padding: "14px", marginTop: 8 }} onClick={completePm} disabled={submitting}>
            {submitting ? "提交中..." : "✅ 完成保养"}
          </button>
        </div>
      )}

      {/* My Orders */}
      {view === "myOrders" && (
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
          <h2 style={{ fontSize: 16, margin: "0 0 8px" }}>📋 工单列表</h2>
          <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>最近20条工单</div>
          {myOrders.length === 0 && (
            <div style={{ textAlign: "center", color: "#64748b", padding: 24 }}>
              <button style={btnStyle()} onClick={() => {
                maintenanceApi.getWorkOrders({ limit: 20 }).then((r: any) => setMyOrders(r?.data ?? [])).catch(() => {});
              }}>加载工单</button>
            </div>
          )}
          {myOrders.map(wo => (
            <div key={wo.id} style={{ background: "#111827", borderRadius: 10, padding: 12, border: "1px solid #1e293b" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontFamily: "monospace", fontSize: 11, color: "#3b82f6" }}>{wo.wo_no}</span>
                <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 8, background: wo.status === "in_processing" ? "#f59e0b22" : "#1e293b", color: wo.status === "in_processing" ? "#f59e0b" : "#94a3b8" }}>{wo.status}</span>
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4 }}>{wo.equipment_name ?? wo.equipment_code}</div>
              <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>{wo.fault_description?.slice(0, 60)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
