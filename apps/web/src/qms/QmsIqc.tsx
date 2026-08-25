import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";

interface IqcDashboard { passRate: number; totalCount: number; passCount: number; failCount: number; pendingCount: number; todayCount: number; oocAlerts: number; calibrationDue: number; mesLocks: number; }
interface IqcInspection { id: number; lot_no: string; material_code: string; material_name: string; supplier_code: string; supplier_name: string; sample_size: number; aql_level: string; inspection_result: string; major_defects: number; minor_defects: number; critical_defects: number; inspector_name: string; inspection_date: string; inspection_mode: string; spc_data_linked: boolean; }
interface IqcItem { id: number; inspection_item_code: string; inspection_item_name: string; inspection_category: string; lower_spec_limit: number; upper_spec_limit: number; target_value: number; measured_value: number; result: string; measurement_device_name: string; inspector_id: string; measured_at: string; }
interface SpcPoint { recorded_at: string; x_bar: number; usl: number; ucl: number; lcl: number; center_line: number; lsl: number; result: string; production_date: string; }
interface SpcAlert { id: number; material_code: string; parameter_code: string; alert_type: string; severity: string; description: string; created_at: string; acknowledged: boolean; }
interface MesLock { id: number; work_order_code: string; material_code: string; lock_reason: string; lock_status: string; locked_at: string; }
interface Calibration { id: number; equipment_code: string; equipment_name: string; equipment_type: string; calibration_status: string; last_calibration_date: string; next_calibration_date: string; calibration_cert_no: string; }

const STATUS_COLOR: Record<string,string> = { PASS: "#34d399", FAIL: "#f87171", CONDITIONAL_PASS: "#fbbf24", PENDING: "#94a3b8" };
const SEVERITY_COLOR: Record<string,string> = { warning: "#fbbf24", critical: "#dc2626" };

// 简单 SVG 控制图
function ControlChart({ data, usl, ucl, lcl, center }: { data: SpcPoint[]; usl: number; ucl: number; lcl: number; center: number }) {
  if (!data.length) return <div style={{ color: "#475569", fontSize: 12 }}>No SPC data</div>;
  const vals = data.map(d => d.x_bar);
  const minV = Math.min(lcl, ...vals);
  const maxV = Math.max(usl, ...vals);
  const pad = (maxV - minV) * 0.15 || 1;
  const W = 500, H = 180, PL = 40, PR = 20, PT = 20, PB = 30;
  const plotW = W - PL - PR, plotH = H - PT - PB;
  const scaleX = (i: number) => PL + (i / (data.length - 1 || 1)) * plotW;
  const scaleY = (v: number) => PT + (1 - (v - (minV - pad)) / (maxV - minV + 2 * pad)) * plotH;
  const pathD = data.map((d, i) => `${i === 0 ? "M" : "L"} ${scaleX(i)} ${scaleY(d.x_bar)}`).join(" ");
  const oocPoints = data.filter(d => d.result === "OUT_OF_CONTROL");
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ background: "#0f172a", borderRadius: 8 }}>
      {/* Grid */}
      {[lcl, center, ucl].map((v, i) => (
        <g key={i}>
          <line x1={PL} y1={scaleY(v)} x2={W-PR} y2={scaleY(v)} stroke="#1e293b" strokeWidth={1} />
          <text x={PL - 4} y={scaleY(v) + 4} fill="#64748b" fontSize={10} textAnchor="end">{v.toFixed(2)}</text>
        </g>
      ))}
      {/* USL/LSL lines */}
      {[{ v: usl, c: "#dc2626" }, { v: ucl, c: "#f97316" }, { v: center, c: "#34d399" }, { v: lcl, c: "#dc2626" }].map(({ v, c }, i) => (
        <line key={i} x1={PL} y1={scaleY(v)} x2={W-PR} y2={scaleY(v)} stroke={c} strokeWidth={1} strokeDasharray={i === 2 ? "0" : "4,4"} opacity={0.7} />
      ))}
      {/* Data line */}
      <path d={pathD} stroke="#38bdf8" strokeWidth={2} fill="none" />
      {/* OOC points */}
      {oocPoints.map((d, i) => {
        const idx = data.indexOf(d);
        return <circle key={i} cx={scaleX(idx)} cy={scaleY(d.x_bar)} r={5} fill="#dc2626" />;
      })}
      {/* X axis labels */}
      {data.filter((_, i) => i % Math.max(1, Math.floor(data.length / 6)) === 0).map((d, i) => {
        const idx = data.indexOf(d);
        return <text key={i} x={scaleX(idx)} y={H - 6} fill="#64748b" fontSize={9} textAnchor="middle">
          {d.production_date ? new Date(d.production_date).toLocaleDateString("en", { month: "short", day: "numeric" }) : ""}
        </text>;
      })}
      {/* Labels */}
      <text x={W/2} y={12} fill="#64748b" fontSize={10} textAnchor="middle">X-bar Control Chart</text>
      <text x={PL - 4} y={14} fill="#dc2626" fontSize={9} textAnchor="end">USL</text>
      <text x={PL - 4} y={PT + 12} fill="#f97316" fontSize={9} textAnchor="end">UCL</text>
      <text x={PL - 4} y={scaleY(center) + 4} fill="#34d399" fontSize={9} textAnchor="end">X̄</text>
      <text x={PL - 4} y={H - PB - 4} fill="#dc2626" fontSize={9} textAnchor="end">LCL</text>
    </svg>
  );
}

export function QmsIqc({ locale }: { locale: string }) {
  const { t } = useTranslation();
  const [view, setView] = useState<"dashboard" | "inspections" | "spc" | "calibration" | "mes-locks">("dashboard");
  const [inspections, setInspections] = useState<IqcInspection[]>([]);
  const [dash, setDash] = useState<IqcDashboard | null>(null);
  const [selected, setSelected] = useState<IqcInspection | null>(null);
  const [items, setItems] = useState<IqcItem[]>([]);
  const [spcData, setSpcData] = useState<SpcPoint[]>([]);
  const [alerts, setAlerts] = useState<SpcAlert[]>([]);
  const [locks, setLocks] = useState<MesLock[]>([]);
  const [calibration, setCalibration] = useState<Calibration[]>([]);
  const [loading, setLoading] = useState(true);
  const [paramFilter, setParamFilter] = useState({ material_code: "", parameter_code: "" });
  const [spcChartData, setSpcChartData] = useState<SpcPoint[]>([]);

  const auth = { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } };

  const loadDash = useCallback(() => {
    fetch("/api/qms/iqc/dashboard", auth)
      .then(r => r.json()).then(d => setDash(d)).catch(() => {});
  }, []);

  const loadInspections = useCallback(() => {
    setLoading(true);
    fetch("/api/qms/oqc/batches?factory_id=1", auth) // fallback to existing endpoint
      .then(r => r.json())
      .then(data => setInspections(Array.isArray(data) ? data.slice(0, 50) : []))
      .catch(() => setInspections([]))
      .finally(() => setLoading(false));
  }, []);

  const loadAlerts = useCallback(() => {
    fetch("/api/qms/iqc/sPc/alerts?acknowledged=false", auth)
      .then(r => r.json()).then(d => setAlerts(Array.isArray(d) ? d : [])).catch(() => setAlerts([]));
  }, []);

  const loadLocks = useCallback(() => {
    fetch("/api/qms/iqc/mes-locks?lock_status=locked", auth)
      .then(r => r.json()).then(d => setLocks(Array.isArray(d) ? d : [])).catch(() => setLocks([]));
  }, []);

  const loadCalibration = useCallback(() => {
    fetch("/api/qms/iqc/calibration?status=due_soon", auth)
      .then(r => r.json()).then(d => setCalibration(Array.isArray(d) ? d : [])).catch(() => setCalibration([]));
  }, []);

  useEffect(() => { loadDash(); loadInspections(); loadAlerts(); loadLocks(); loadCalibration(); }, [loadDash, loadInspections, loadAlerts, loadLocks, loadCalibration]);

  const openInspection = (insp: IqcInspection) => {
    setSelected(insp);
    setItems([]);
    setSpcData([]);
    // Load measurement items
    fetch(`/api/qms/iqc/inspections/${insp.id}/items`, auth)
      .then(r => r.json()).then(d => setItems(Array.isArray(d) ? d : [])).catch(() => {});
    // Load SPC data for this lot
    fetch(`/api/qms/iqc/sPc/data?control_lot_id=${insp.id}&limit=100`, auth)
      .then(r => r.json())
      .then(d => { const arr = Array.isArray(d) ? d : []; setSpcData(arr); setSpcChartData(arr); })
      .catch(() => {});
  };

  const loadSpcChart = () => {
    if (!paramFilter.material_code || !paramFilter.parameter_code) return;
    fetch(`/api/qms/iqc/sPc/control-chart?material_code=${paramFilter.material_code}&parameter_code=${paramFilter.parameter_code}&limit=50`, auth)
      .then(r => r.json())
      .then(d => setSpcChartData(Array.isArray(d) ? d : []))
      .catch(() => {});
  };

  const acknowledgeAlert = (id: number) => {
    fetch(`/api/qms/iqc/sPc/alerts/${id}/acknowledge`, { method: "PUT", ...auth })
      .then(r => r.json()).then(() => loadAlerts());
  };

  const releaseLock = (id: number) => {
    if (!confirm("Release this MES work order lock?")) return;
    fetch(`/api/qms/iqc/mes-locks/${id}/release`, { method: "PUT", ...auth })
      .then(r => r.json()).then(() => loadLocks());
  };

  // Dashboard metric cards
  const MetricCard = ({ label, value, color, onClick }: { label: string; value: number | string; color: string; onClick?: () => void }) => (
    <div onClick={onClick} style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "12px 16px", textAlign: "center", cursor: onClick ? "pointer" : "default", minWidth: 100 }}>
      <div style={{ color, fontSize: 28, fontWeight: 700 }}>{value}</div>
      <div style={{ color: "#64748b", fontSize: 11, marginTop: 4 }}>{label}</div>
    </div>
  );

  return (
    <div style={{ padding: 24 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ color: "#e2e8f0", fontSize: 20, margin: 0 }}>
          {t("qms.iqcTitle") || "IQC 来料检验"}
        </h2>
        <div style={{ display: "flex", gap: 6 }}>
          {(["dashboard","inspections","spc","calibration","mes-locks"] as const).map(v => (
            <button key={v} onClick={() => setView(v)}
              style={{ padding: "5px 12px", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12,
                background: view === v ? "#2563eb" : "#334155", color: view === v ? "#fff" : "#94a3b8" }}>
              {locale === 'zh-CN' ? (v === "dashboard" ? "仪表盘" : v === "inspections" ? "检验记录" : v === "spc" ? "SPC控制图" : v === "calibration" ? "计量设备" : "MES锁定") : locale === 'vi-VN' ? (v === "dashboard" ? "Đồng hồ" : v === "inspections" ? "Hồ sơ QC" : v === "spc" ? "Đồ thị SPC" : v === "calibration" ? "Thiết bị đo" : "Khóa MES") : (v === "dashboard" ? "Dashboard" : v === "inspections" ? "Inspections" : v === "spc" ? "SPC Charts" : v === "calibration" ? "Calibration" : "MES Locks")}
            </button>
          ))}
        </div>
      </div>

      {/* Dashboard */}
      {view === "dashboard" && dash && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
            <MetricCard label={locale === 'zh-CN' ? '今日检验' : locale === 'vi-VN' ? 'QC hôm nay' : 'Today'} value={dash.todayCount} color="#38bdf8" />
            <MetricCard label={locale === 'zh-CN' ? '待检' : locale === 'vi-VN' ? 'Chờ kiểm' : 'Pending'} value={dash.pendingCount} color="#fbbf24" />
            <MetricCard label={locale === 'zh-CN' ? '合格率' : locale === 'vi-VN' ? 'Tỷ lệ đạt' : 'Pass Rate'} value={`${dash.passRate}%`} color="#34d399" onClick={() => setView("inspections")} />
            <MetricCard label={locale === 'zh-CN' ? '不合格' : locale === 'vi-VN' ? 'Không đạt' : 'Failed'} value={dash.failCount} color="#f87171" />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
            <MetricCard label={locale === 'zh-CN' ? 'OOC告警' : locale === 'vi-VN' ? 'Cảnh báo OOC' : 'OOC Alerts'} value={dash.oocAlerts} color="#dc2626" onClick={() => setView("spc")} />
            <MetricCard label={locale === 'zh-CN' ? '校准到期' : locale === 'vi-VN' ? 'Hết hiệu chuẩn' : 'Calibration Due'} value={dash.calibrationDue} color="#fbbf24" onClick={() => setView("calibration")} />
            <MetricCard label={locale === 'zh-CN' ? 'MES锁定' : locale === 'vi-VN' ? 'Khóa MES' : 'MES Locks'} value={dash.mesLocks} color="#f97316" onClick={() => setView("mes-locks")} />
            <MetricCard label={locale === 'zh-CN' ? '累计检验' : locale === 'vi-VN' ? 'Tổng QC' : 'Total'} value={dash.totalCount} color="#94a3b8" />
          </div>

          {/* OOC Alerts */}
          {alerts.length > 0 && (
            <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <h3 style={{ color: "#dc2626", marginTop: 0, fontSize: 14 }}>⚠ SPC 超限告警 ({alerts.length})</h3>
              <div style={{ display: "grid", gap: 8 }}>
                {alerts.slice(0, 5).map(a => (
                  <div key={a.id} style={{ background: "#0f172a", border: "1px solid #dc2626", borderRadius: 6, padding: "8px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <span style={{ color: "#f87171", fontSize: 12, fontWeight: 600 }}>[{a.alert_type}]</span>
                      <span style={{ color: "#e2e8f0", fontSize: 13, marginLeft: 8 }}>{a.material_code} / {a.parameter_code}</span>
                      <div style={{ color: "#64748b", fontSize: 11, marginTop: 2 }}>{a.description}</div>
                    </div>
                    <button onClick={() => acknowledgeAlert(a.id)} style={{ padding: "4px 12px", background: "#dc2626", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 12 }}>确认</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Calibration Due */}
          {calibration.length > 0 && (
            <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: 16 }}>
              <h3 style={{ color: "#fbbf24", marginTop: 0, fontSize: 14 }}>📐 计量设备待校准 ({calibration.length})</h3>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 8 }}>
                {calibration.map(c => (
                  <div key={c.id} style={{ background: "#0f172a", borderRadius: 6, padding: "8px 12px" }}>
                    <div style={{ color: "#e2e8f0", fontSize: 13, fontWeight: 600 }}>{c.equipment_name}</div>
                    <div style={{ color: "#64748b", fontSize: 11 }}>{c.equipment_code} | {locale === 'zh-CN' ? '下次' : locale === 'vi-VN' ? 'Tiếp theo' : 'Next'}: {c.next_calibration_date}</div>
                    <div style={{ color: c.calibration_status === "expired" ? "#dc2626" : "#fbbf24", fontSize: 11, marginTop: 2 }}>{c.calibration_status === "expired" ? (locale === 'zh-CN' ? '已过期' : locale === 'vi-VN' ? 'Đã hết hạn' : 'Expired') : (locale === 'zh-CN' ? '即将到期' : locale === 'vi-VN' ? 'Sắp hết hạn' : 'Expiring Soon')}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Inspections List */}
      {view === "inspections" && (
        <div>
          {loading ? <div style={{ color: "#64748b" }}>加载中…</div> : (
            <div style={{ display: "grid", gap: 10 }}>
              {inspections.map(insp => (
                <div key={insp.id} onClick={() => openInspection(insp)}
                  style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "12px 16px", cursor: "pointer", borderLeft: `4px solid ${STATUS_COLOR[insp.inspection_result] || "#94a3b8"}` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ color: "#e2e8f0", fontWeight: 600, fontSize: 14 }}>{insp.lot_no}</div>
                      <div style={{ color: "#64748b", fontSize: 12, marginTop: 2 }}>{insp.material_code} / {insp.supplier_name || insp.supplier_code}</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ background: STATUS_COLOR[insp.inspection_result] || "#94a3b8", padding: "2px 10px", borderRadius: 4, color: "#fff", fontSize: 12, fontWeight: 600 }}>
                        {insp.inspection_result || "PENDING"}
                      </span>
                      {insp.spc_data_linked && <span style={{ background: "#7c3aed", padding: "2px 8px", borderRadius: 4, color: "#fff", fontSize: 11 }}>SPC</span>}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 16, marginTop: 6, color: "#475569", fontSize: 11 }}>
                    <span>AQL: {insp.aql_level}</span>
                    <span>样本: {insp.sample_size}</span>
                    <span>检验员: {insp.inspector_name}</span>
                    <span>{insp.inspection_date ? new Date(insp.inspection_date).toLocaleDateString() : "-"}</span>
                  </div>
                </div>
              ))}
              {inspections.length === 0 && <div style={{ color: "#475569", textAlign: "center", padding: 40 }}>暂无检验记录</div>}
            </div>
          )}
        </div>
      )}

      {/* SPC Control Chart */}
      {view === "spc" && (
        <div>
          <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: 16, marginBottom: 16 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
              <div>
                <label style={{ color: "#94a3b8", fontSize: 12, display: "block", marginBottom: 4 }}>物料编码</label>
                <input value={paramFilter.material_code} onChange={e => setParamFilter({ ...paramFilter, material_code: e.target.value })}
                  style={{ padding: "6px 12px", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", width: 200 }} />
              </div>
              <div>
                <label style={{ color: "#94a3b8", fontSize: 12, display: "block", marginBottom: 4 }}>参数编码</label>
                <input value={paramFilter.parameter_code} onChange={e => setParamFilter({ ...paramFilter, parameter_code: e.target.value })}
                  style={{ padding: "6px 12px", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", width: 150 }} />
              </div>
              <button onClick={loadSpcChart} style={{ padding: "6px 20px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>查询</button>
            </div>
          </div>
          {spcChartData.length > 0 ? (
            <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: 16 }}>
              <ControlChart
                data={spcChartData}
                usl={spcChartData[0]?.usl || 0}
                ucl={spcChartData[0]?.ucl || 0}
                lcl={spcChartData[0]?.lcl || 0}
                center={spcChartData[0]?.center_line || 0}
              />
            </div>
          ) : (
            <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: 40, textAlign: "center", color: "#475569" }}>
              输入物料编码和参数编码后查询控制图
            </div>
          )}

          {/* Recent OOC alerts */}
          <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: 16, marginTop: 16 }}>
            <h3 style={{ color: "#e2e8f0", marginTop: 0, fontSize: 14 }}>近期 SPC 告警</h3>
            {alerts.length === 0 ? <div style={{ color: "#475569" }}>无告警</div> : alerts.map(a => (
              <div key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid #1e293b" }}>
                <div>
                  <span style={{ color: SEVERITY_COLOR[a.severity] || "#fbbf24", fontSize: 12 }}>[{a.alert_type}]</span>
                  <span style={{ color: "#e2e8f0", fontSize: 13, marginLeft: 8 }}>{a.material_code} / {a.parameter_code}</span>
                  <div style={{ color: "#64748b", fontSize: 11 }}>{a.description}</div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {a.acknowledged ? <span style={{ color: "#34d399", fontSize: 12 }}>已确认</span> : (
                    <button onClick={() => acknowledgeAlert(a.id)} style={{ padding: "3px 10px", background: "#dc2626", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 12 }}>确认</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* MES Locks */}
      {view === "mes-locks" && (
        <div>
          {locks.length === 0 ? (
            <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: 40, textAlign: "center", color: "#475569" }}>无锁定中的工单</div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {locks.map(l => (
                <div key={l.id} style={{ background: "#1e293b", border: "1px solid #f97316", borderRadius: 8, padding: "12px 16px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ color: "#e2e8f0", fontWeight: 600 }}>工单: {l.work_order_code}</div>
                      <div style={{ color: "#64748b", fontSize: 12, marginTop: 2 }}>{l.material_code} | 锁定原因: {l.lock_reason}</div>
                      <div style={{ color: "#475569", fontSize: 11 }}>锁定时间: {l.locked_at ? new Date(l.locked_at).toLocaleString() : "-"}</div>
                    </div>
                    <button onClick={() => releaseLock(l.id)} style={{ padding: "6px 16px", background: "#16a34a", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>解除锁定</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Calibration */}
      {view === "calibration" && (
        <div>
          {calibration.length === 0 ? (
            <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: 40, textAlign: "center", color: "#475569" }}>无计量设备到期</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
              {calibration.map(c => (
                <div key={c.id} style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: 16 }}>
                  <div style={{ color: "#e2e8f0", fontWeight: 600, fontSize: 14 }}>{c.equipment_name}</div>
                  <div style={{ color: "#64748b", fontSize: 12, marginTop: 4 }}>编码: {c.equipment_code}</div>
                  <div style={{ color: "#64748b", fontSize: 12 }}>类型: {c.equipment_type}</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, marginTop: 8, fontSize: 12, color: "#94a3b8" }}>
                    <div>上次校准: <span style={{ color: "#e2e8f0" }}>{c.last_calibration_date}</span></div>
                    <div>下次校准: <span style={{ color: c.calibration_status === "expired" ? "#dc2626" : "#fbbf24" }}>{c.next_calibration_date}</span></div>
                  </div>
                  <div style={{ color: "#64748b", fontSize: 11, marginTop: 4 }}>证书: {c.calibration_cert_no || "-"}</div>
                  <div style={{ marginTop: 8 }}>
                    <span style={{ background: c.calibration_status === "expired" ? "#dc2626" : "#fbbf24", padding: "2px 8px", borderRadius: 4, color: "#fff", fontSize: 11 }}>
{c.calibration_status === "expired" ? (locale === 'zh-CN' ? '已过期' : locale === 'vi-VN' ? 'Đã hết hạn' : 'Expired') : (locale === 'zh-CN' ? '即将到期' : locale === 'vi-VN' ? 'Sắp hết hạn' : 'Expiring Soon')}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Inspection Detail Modal */}
      {selected && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 12, padding: 24, width: 720, maxHeight: "85vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <h3 style={{ color: "#e2e8f0", marginTop: 0 }}>批次: {selected.lot_no}</h3>
              <button onClick={() => setSelected(null)} style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: 20 }}>×</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, color: "#94a3b8", fontSize: 12, margin: "12px 0" }}>
              <div>物料: <span style={{ color: "#e2e8f0" }}>{selected.material_code}</span></div>
              <div>供应商: <span style={{ color: "#e2e8f0" }}>{selected.supplier_name || selected.supplier_code}</span></div>
              <div>结果: <span style={{ color: STATUS_COLOR[selected.inspection_result] || "#94a3b8", fontWeight: 600 }}>{selected.inspection_result || "PENDING"}</span></div>
              <div>样本: <span style={{ color: "#e2e8f0" }}>{selected.sample_size}</span></div>
              <div>AQL: <span style={{ color: "#e2e8f0" }}>{selected.aql_level}</span></div>
              <div>检验员: <span style={{ color: "#e2e8f0" }}>{selected.inspector_name}</span></div>
            </div>

            {/* SPC Chart */}
            {spcData.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <h4 style={{ color: "#38bdf8", margin: "8px 0", fontSize: 13 }}>SPC 控制图</h4>
                <ControlChart
                  data={spcData}
                  usl={spcData[0]?.usl || 0}
                  ucl={spcData[0]?.ucl || 0}
                  lcl={spcData[0]?.lcl || 0}
                  center={spcData[0]?.center_line || 0}
                />
              </div>
            )}

            {/* Measurement Items */}
            {items.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <h4 style={{ color: "#38bdf8", margin: "8px 0", fontSize: 13 }}>测量项目 ({items.length})</h4>
                <div style={{ display: "grid", gap: 6 }}>
                  {items.map(item => (
                    <div key={item.id} style={{ background: "#0f172a", borderRadius: 6, padding: "8px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <span style={{ color: "#e2e8f0", fontSize: 13 }}>{item.inspection_item_name}</span>
                        <span style={{ color: "#64748b", fontSize: 11, marginLeft: 8 }}>[{item.inspection_category}]</span>
                        <div style={{ color: "#475569", fontSize: 11 }}>
                          规格: [{item.lower_spec_limit ?? "-"}, {item.upper_spec_limit ?? "-"}] 目标: {item.target_value ?? "-"}
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ color: item.result === "PASS" ? "#34d399" : "#f87171", fontSize: 18, fontWeight: 700 }}>
                          {item.measured_value ?? "-"}
                        </div>
                        <div style={{ color: "#64748b", fontSize: 11 }}>{item.measurement_device_name || "N/A"}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button onClick={() => setSelected(null)} style={{ marginTop: 16, width: "100%", padding: "10px", background: "#334155", color: "#e2e8f0", border: "none", borderRadius: 6, cursor: "pointer" }}>关闭</button>
          </div>
        </div>
      )}
    </div>
  );
}
