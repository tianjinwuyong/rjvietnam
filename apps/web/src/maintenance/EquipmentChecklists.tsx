import { useState, useMemo, useEffect } from "react";
import { t } from "../i18n";
import type { Locale, ChecklistTemplate, ChecklistItem, CheckingRecord, CheckingRecordDetail, ChecklistSchedule, ComplianceSummary, ComplianceByEquipment, ComplianceByInspector } from "../../../../packages/shared-types/src/factory";
import { maintenanceApi } from "../api";

interface Props { locale: Locale }

type SubTab = "execute" | "templates" | "compliance" | "schedule";

const _useDemo = true;

const demoEquipmentList = [
  { id: "eq-001", code: "SMT-NXT-01", nameZh: "Fuji NXT III #1", type: "SMT-NXT", line: "L1" },
  { id: "eq-002", code: "SMT-NXT-02", nameZh: "Fuji NXT III #2", type: "SMT-NXT", line: "L1" },
  { id: "eq-003", code: "PRINTER-DEK-01", nameZh: "DEK Horizon #1", type: "PRINTER-DEK", line: "L1" },
  { id: "eq-004", code: "AOI-CTI-01", nameZh: "CTI A40 AOI", type: "AOI-CTI", line: "L2" },
  { id: "eq-005", code: "REF-V8-01", nameZh: "Rehm V8 Reflow", type: "REF-V8", line: "L2" },
  { id: "eq-006", code: "PRINTER-DEK-02", nameZh: "DEK Horizon #2", type: "PRINTER-DEK", line: "L2" },
];

const demoData: ChecklistTemplate[] = [
  {
    id: "tpl-1", templateCode: "CHK-SMT-NXT-DAILY", templateName: "Fuji NXT III 每日点检表",
    equipmentType: "SMT-NXT", frequency: "daily", isActive: true, version: 1, createdAt: "2026-06-01",
    items: [
      { id: "ci-1", templateId: "tpl-1", itemOrder: 1, checkPoint: "气压表读数是否在0.5-0.7MPa", checkMethod: "目视检查气压表指针", standardValue: "0.5-0.7 MPa", resultType: "pass_fail", category: "pressure", failurePriority: "critical", isOptional: false },
      { id: "ci-2", templateId: "tpl-1", itemOrder: 2, checkPoint: "紧急停止按钮是否正常", checkMethod: "按下再复位测试", standardValue: "按钮弹起正常", resultType: "pass_fail", category: "safety", failurePriority: "critical", isOptional: false },
      { id: "ci-3", templateId: "tpl-1", itemOrder: 3, checkPoint: "吸嘴磨损检查", checkMethod: "放大镜检查", standardValue: "无磨损变形", resultType: "pass_fail", category: "mechanical", failurePriority: "high", isOptional: false },
      { id: "ci-4", templateId: "tpl-1", itemOrder: 4, checkPoint: "轨道宽度与PCB匹配", checkMethod: "放入PCB试运行", standardValue: "PCB进出顺畅", resultType: "pass_fail", category: "operation", failurePriority: "high", isOptional: false },
      { id: "ci-5", templateId: "tpl-1", itemOrder: 5, checkPoint: "真空压力值", checkMethod: "读取设备真空表", standardValue: "≥ -80 kPa", resultType: "numeric", unit: "kPa", lowerLimit: -80, category: "pressure", failurePriority: "high", isOptional: false },
      { id: "ci-6", templateId: "tpl-1", itemOrder: 6, checkPoint: "设备运行有无异响", checkMethod: "听诊", standardValue: "无异响", resultType: "pass_fail", category: "mechanical", failurePriority: "medium", isOptional: false },
      { id: "ci-7", templateId: "tpl-1", itemOrder: 7, checkPoint: "飞达供料是否正常", checkMethod: "观察供料动作", standardValue: "供料无卡顿", resultType: "pass_fail", category: "mechanical", failurePriority: "medium", isOptional: false },
      { id: "ci-8", templateId: "tpl-1", itemOrder: 8, checkPoint: "视觉相机清洁", checkMethod: "无尘布擦拭", standardValue: "无污渍", resultType: "pass_fail", category: "operation", failurePriority: "medium", isOptional: false },
      { id: "ci-9", templateId: "tpl-1", itemOrder: 9, checkPoint: "报警灯/蜂鸣器功能", checkMethod: "触发测试", standardValue: "声光正常", resultType: "pass_fail", category: "safety", failurePriority: "medium", isOptional: false },
      { id: "ci-10", templateId: "tpl-1", itemOrder: 10, checkPoint: "排出 conveyor 无异物", checkMethod: "目视检查", standardValue: "无残留", resultType: "pass_fail", category: "cleanliness", failurePriority: "low", isOptional: true },
    ],
  },
  {
    id: "tpl-2", templateCode: "CHK-DEK-DAILY", templateName: "DEK Horizon 每日点检表",
    equipmentType: "PRINTER-DEK", frequency: "daily", isActive: true, version: 1, createdAt: "2026-06-01",
    items: [
      { id: "ci-11", templateId: "tpl-2", itemOrder: 1, checkPoint: "刮刀压力是否正常", checkMethod: "读取压力值", standardValue: "80-120 N", resultType: "numeric", unit: "N", lowerLimit: 80, upperLimit: 120, category: "pressure", failurePriority: "high", isOptional: false },
      { id: "ci-12", templateId: "tpl-2", itemOrder: 2, checkPoint: "钢网张力是否达标", checkMethod: "张力计测试", standardValue: "≥ 35 N/cm²", resultType: "numeric", unit: "N/cm²", lowerLimit: 35, category: "operation", failurePriority: "high", isOptional: false },
      { id: "ci-13", templateId: "tpl-2", itemOrder: 3, checkPoint: "钢网有无破损", checkMethod: "目视检查", standardValue: "无破损变形", resultType: "pass_fail", category: "mechanical", failurePriority: "critical", isOptional: false },
      { id: "ci-14", templateId: "tpl-2", itemOrder: 4, checkPoint: "紧急停止按钮", checkMethod: "按下复位测试", standardValue: "弹起正常", resultType: "pass_fail", category: "safety", failurePriority: "critical", isOptional: false },
    ],
  },
  {
    id: "tpl-3", templateCode: "CHK-REFLOW-DAILY", templateName: "Rehm V8 每日点检表",
    equipmentType: "REF-V8", frequency: "daily", isActive: true, version: 1, createdAt: "2026-06-01",
    items: [
      { id: "ci-15", templateId: "tpl-3", itemOrder: 1, checkPoint: "各温区温度曲线验证", checkMethod: "读取曲线", standardValue: "±5°C", resultType: "pass_fail", category: "temperature", failurePriority: "critical", isOptional: false },
      { id: "ci-16", templateId: "tpl-3", itemOrder: 2, checkPoint: "N2 流量/浓度", checkMethod: "读取流量计", standardValue: "≥ 800 ppm", resultType: "numeric", unit: "ppm", lowerLimit: 800, category: "operation", failurePriority: "high", isOptional: false },
      { id: "ci-17", templateId: "tpl-3", itemOrder: 3, checkPoint: "冷却区温度", checkMethod: "读取温度值", standardValue: "≤ 40°C", resultType: "numeric", unit: "°C", upperLimit: 40, category: "temperature", failurePriority: "medium", isOptional: false },
      { id: "ci-18", templateId: "tpl-3", itemOrder: 4, checkPoint: "紧急停止按钮", checkMethod: "按下复位测试", standardValue: "弹起正常", resultType: "pass_fail", category: "safety", failurePriority: "critical", isOptional: false },
    ],
  },
];

const demoRecords: CheckingRecord[] = [
  { id: "rec-1", recordNo: "CHK-240628-001", templateId: "tpl-1", equipmentId: "eq-001", equipmentCode: "SMT-NXT-01", equipmentNameZh: "Fuji NXT III #1", lineId: "L1", lineName: "L1", frequency: "daily", shiftType: "day", checkDate: "2026-06-28", checkTime: "2026-06-28T08:15:00Z", inspectorName: "Nguyen Van A", totalItems: 10, passedItems: 9, failedItems: 1, skippedItems: 0, overallResult: "conditional_pass", notes: "真空压力略低", createdAt: "2026-06-28T08:30:00Z",
    details: [
      { id: "det-1", recordId: "rec-1", itemId: "ci-1", itemOrder: 1, checkPoint: "气压表读数", result: "pass", createdAt: "2026-06-28T08:15:00Z" },
      { id: "det-2", recordId: "rec-1", itemId: "ci-2", itemOrder: 2, checkPoint: "急停按钮", result: "pass", createdAt: "2026-06-28T08:16:00Z" },
      { id: "det-3", recordId: "rec-1", itemId: "ci-3", itemOrder: 3, checkPoint: "吸嘴磨损", result: "pass", createdAt: "2026-06-28T08:17:00Z" },
      { id: "det-4", recordId: "rec-1", itemId: "ci-4", itemOrder: 4, checkPoint: "轨道宽度", result: "pass", createdAt: "2026-06-28T08:18:00Z" },
      { id: "det-5", recordId: "rec-1", itemId: "ci-5", itemOrder: 5, checkPoint: "真空压力值", result: "pass", numericValue: -82, notes: "略低，已通知组长", createdAt: "2026-06-28T08:20:00Z" },
      { id: "det-6", recordId: "rec-1", itemId: "ci-6", itemOrder: 6, checkPoint: "运行异响", result: "pass", createdAt: "2026-06-28T08:21:00Z" },
      { id: "det-7", recordId: "rec-1", itemId: "ci-7", itemOrder: 7, checkPoint: "飞达供料", result: "pass", createdAt: "2026-06-28T08:22:00Z" },
      { id: "det-8", recordId: "rec-1", itemId: "ci-8", itemOrder: 8, checkPoint: "相机清洁", result: "pass", createdAt: "2026-06-28T08:23:00Z" },
      { id: "det-9", recordId: "rec-1", itemId: "ci-9", itemOrder: 9, checkPoint: "报警灯", result: "pass", createdAt: "2026-06-28T08:24:00Z" },
      { id: "det-10", recordId: "rec-1", itemId: "ci-10", itemOrder: 10, checkPoint: "conveyor异物", result: "fail", notes: "发现锡渣残留", createdAt: "2026-06-28T08:25:00Z" },
    ],
  },
  { id: "rec-2", recordNo: "CHK-240628-002", templateId: "tpl-1", equipmentId: "eq-002", equipmentCode: "SMT-NXT-02", equipmentNameZh: "Fuji NXT III #2", lineId: "L1", lineName: "L1", frequency: "daily", shiftType: "day", checkDate: "2026-06-28", checkTime: "2026-06-28T08:30:00Z", inspectorName: "Tran Van B", totalItems: 10, passedItems: 10, failedItems: 0, skippedItems: 0, overallResult: "pass", createdAt: "2026-06-28T08:45:00Z" },
  { id: "rec-3", recordNo: "CHK-240628-003", templateId: "tpl-2", equipmentId: "eq-003", equipmentCode: "PRINTER-DEK-01", equipmentNameZh: "DEK Horizon #1", lineId: "L1", lineName: "L1", frequency: "daily", shiftType: "day", checkDate: "2026-06-28", checkTime: "2026-06-28T07:50:00Z", inspectorName: "Nguyen Van A", totalItems: 4, passedItems: 4, failedItems: 0, skippedItems: 0, overallResult: "pass", createdAt: "2026-06-28T08:00:00Z" },
];

const demoSchedule: ChecklistSchedule[] = [
  { id: "sch-1", equipmentId: "eq-001", templateId: "tpl-1", frequency: "daily", scheduledDate: "2026-06-28", shiftType: "day", assignedInspector: "Nguyen Van A", status: "completed", recordId: "rec-1" },
  { id: "sch-2", equipmentId: "eq-002", templateId: "tpl-1", frequency: "daily", scheduledDate: "2026-06-28", shiftType: "day", assignedInspector: "Tran Van B", status: "completed", recordId: "rec-2" },
  { id: "sch-3", equipmentId: "eq-003", templateId: "tpl-2", frequency: "daily", scheduledDate: "2026-06-28", shiftType: "day", assignedInspector: "Nguyen Van A", status: "completed", recordId: "rec-3" },
  { id: "sch-4", equipmentId: "eq-004", templateId: "tpl-4", frequency: "daily", scheduledDate: "2026-06-28", shiftType: "day", assignedInspector: "Le Thi C", status: "pending" },
  { id: "sch-5", equipmentId: "eq-005", templateId: "tpl-3", frequency: "daily", scheduledDate: "2026-06-28", shiftType: "day", assignedInspector: "Le Thi C", status: "pending" },
  { id: "sch-6", equipmentId: "eq-006", templateId: "tpl-2", frequency: "daily", scheduledDate: "2026-06-28", shiftType: "night", assignedInspector: "Pham Van D", status: "missed" },
];

function ChecklistExecuteView({ locale, templates, records }: { locale: Locale; templates: ChecklistTemplate[]; records: CheckingRecord[] }) {
  const today = new Date().toISOString().slice(0, 10);
  const [expandedRecord, setExpandedRecord] = useState<string | null>(null);

  const todayRecords = useMemo(() => records.filter(r => r.checkDate === today), [records, today]);

  const getTemplateName = (tid: string) => templates.find(t => t.id === tid)?.templateName ?? tid;

  const resultTone = (r: string) => {
    if (r === "pass") return "ok";
    if (r === "fail") return "danger";
    return "muted";
  };

  const overallTone = (r: string) => {
    if (r === "pass") return "ok";
    if (r === "conditional_pass") return "warning";
    return "danger";
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="surface-panel">
        <div className="section-header">
          <h2>{t("mchk.execute", locale)}</h2>
          <p>{t("mchk.executeDesc", locale)}</p>
        </div>
      </div>

      {todayRecords.length === 0 && (
        <section className="surface-panel" style={{ textAlign: "center", padding: 40 }}>
          <p style={{ color: "var(--muted)" }}>{t("mchk.noRecords", locale)}</p>
        </section>
      )}

      {todayRecords.map(rec => (
        <section key={rec.id} className="surface-panel">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div>
              <strong style={{ fontSize: 16 }}>{rec.recordNo}</strong>
              <span style={{ marginLeft: 12, color: "var(--muted)" }}>{rec.equipmentCode} — {rec.equipmentNameZh}</span>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span className={`badge badge-${overallTone(rec.overallResult)}`}>{t("mchk.result." + rec.overallResult, locale)}</span>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{rec.inspectorName} / {rec.shiftType}</span>
              {rec.verifiedBy && <span className="badge badge-ok">{t("mchk.verified", locale)}</span>}
            </div>
          </div>

          <div className="table-shell" style={{ marginBottom: 8 }}>
            <table>
              <thead>
                <tr>
                  <th style={{ width: 40 }}>#</th>
                  <th>{t("mchk.checkPoint", locale)}</th>
                  <th>{t("mchk.standard", locale)}</th>
                  <th style={{ width: 80 }}>{t("mchk.result", locale)}</th>
                  <th>{t("mchk.notes", locale)}</th>
                </tr>
              </thead>
              <tbody>
                {(rec.details ?? []).map(det => (
                  <tr key={det.id}>
                    <td>{det.itemOrder}</td>
                    <td>{det.checkPoint ?? ""}</td>
                    <td style={{ fontSize: 12, color: "var(--muted)" }}>
                      {(() => {
                        const item = templates.find(t => t.id === rec.templateId)?.items?.find(i => i.id === det.itemId);
                        return item?.standardValue ?? "";
                      })()}
                    </td>
                    <td><span className={`badge badge-${resultTone(det.result)}`}>{t("mchk.result." + det.result, locale)}</span></td>
                    <td style={{ fontSize: 12 }}>{det.notes ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {rec.notes && (
            <div style={{ fontSize: 13, padding: "8px 12px", background: "var(--bg-muted)", borderRadius: 6 }}>
              <strong>{t("mchk.summaryNote", locale)}:</strong> {rec.notes}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

function TemplatesView({ locale, templates }: { locale: Locale; templates: ChecklistTemplate[] }) {
  const [expandedTpl, setExpandedTpl] = useState<string | null>(null);

  const freqLabel = (f: string) => t("mchk.freq." + f, locale);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="surface-panel">
        <div className="section-header">
          <h2>{t("mchk.templates", locale)}</h2>
          <p>{t("mchk.templatesDesc", locale)}</p>
        </div>
      </div>

      {templates.map(tpl => (
        <section key={tpl.id} className="surface-panel">
          <div
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
            onClick={() => setExpandedTpl(expandedTpl === tpl.id ? null : tpl.id)}
          >
            <div>
              <strong style={{ fontSize: 16 }}>{tpl.templateCode}</strong>
              <span style={{ marginLeft: 12 }}>{tpl.templateName}</span>
              <span style={{ marginLeft: 12, fontSize: 12, color: "var(--muted)" }}>{tpl.equipmentType}</span>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span className="badge badge-info">{freqLabel(tpl.frequency)}</span>
              <span className={`badge badge-${tpl.isActive ? "ok" : "muted"}`}>{tpl.isActive ? t("common.active", locale) : t("common.inactive", locale)}</span>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>v{tpl.version} · {(tpl.items ?? []).length}{t("mchk.items", locale)}</span>
            </div>
          </div>

          {expandedTpl === tpl.id && (tpl.items ?? []).length > 0 && (
            <div className="table-shell" style={{ marginTop: 12 }}>
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 40 }}>#</th>
                    <th>{t("mchk.checkPoint", locale)}</th>
                    <th>{t("mchk.checkMethod", locale)}</th>
                    <th>{t("mchk.standard", locale)}</th>
                    <th>{t("mchk.type", locale)}</th>
                    <th>{t("mchk.category", locale)}</th>
                    <th style={{ width: 60 }}>{t("mchk.optional", locale)}</th>
                  </tr>
                </thead>
                <tbody>
                  {(tpl.items ?? []).map(item => (
                    <tr key={item.id}>
                      <td>{item.itemOrder}</td>
                      <td>{item.checkPoint}</td>
                      <td style={{ fontSize: 12 }}>{item.checkMethod ?? ""}</td>
                      <td style={{ fontSize: 12 }}>{item.standardValue ?? ""}</td>
                      <td>{item.resultType === "numeric" ? (item.unit ? item.resultType + " (" + item.unit + ")" : item.resultType) : item.resultType}</td>
                      <td><span className="badge badge-muted">{t("mchk.cat." + item.category, locale)}</span></td>
                      <td>{item.isOptional ? "✓" : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

function ComplianceView({ locale }: { locale: Locale }) {
  const today = new Date().toISOString().slice(0, 10);

  const stats: ComplianceSummary = {
    totalScheduled: 6, completed: 3, missed: 1, overridden: 0,
    complianceRate: 50, onTimeRate: 66.7, skipRate: 0, verificationRate: 33.3,
    period: { from: today, to: today },
  };

  const byEquip: ComplianceByEquipment[] = [
    { equipmentId: "eq-001", equipmentCode: "SMT-NXT-01", equipmentNameZh: "Fuji NXT III #1", scheduled: 1, completed: 1, missed: 0, complianceRate: 100 },
    { equipmentId: "eq-002", equipmentCode: "SMT-NXT-02", equipmentNameZh: "Fuji NXT III #2", scheduled: 1, completed: 1, missed: 0, complianceRate: 100 },
    { equipmentId: "eq-003", equipmentCode: "PRINTER-DEK-01", equipmentNameZh: "DEK Horizon #1", scheduled: 1, completed: 1, missed: 0, complianceRate: 100 },
    { equipmentId: "eq-004", equipmentCode: "AOI-CTI-01", equipmentNameZh: "CTI A40 AOI", scheduled: 1, completed: 0, missed: 0, complianceRate: 0 },
    { equipmentId: "eq-005", equipmentCode: "REF-V8-01", equipmentNameZh: "Rehm V8 Reflow", scheduled: 1, completed: 0, missed: 0, complianceRate: 0 },
    { equipmentId: "eq-006", equipmentCode: "PRINTER-DEK-02", equipmentNameZh: "DEK Horizon #2", scheduled: 1, completed: 0, missed: 1, complianceRate: 0 },
  ];

  const barWidth = (pct: number) => Math.round(pct * 1.2);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="surface-panel">
        <div className="section-header">
          <h2>{t("mchk.compliance", locale)}</h2>
          <p>{t("mchk.complianceDesc", locale)}</p>
        </div>
      </div>

      <section className="surface-panel">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 16 }}>
          <div style={{ textAlign: "center", padding: 16 }}>
            <div style={{ fontSize: 28, fontWeight: 700 }}>{stats.complianceRate}%</div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>{t("mchk.complianceRate", locale)}</div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>({stats.completed}/{stats.totalScheduled})</div>
          </div>
          <div style={{ textAlign: "center", padding: 16 }}>
            <div style={{ fontSize: 28, fontWeight: 700 }}>{stats.onTimeRate}%</div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>{t("mchk.onTimeRate", locale)}</div>
          </div>
          <div style={{ textAlign: "center", padding: 16 }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: "var(--danger)" }}>{stats.missed}</div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>{t("mchk.missed", locale)}</div>
          </div>
          <div style={{ textAlign: "center", padding: 16 }}>
            <div style={{ fontSize: 28, fontWeight: 700 }}>{stats.skipRate}%</div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>{t("mchk.skipRate", locale)}</div>
          </div>
          <div style={{ textAlign: "center", padding: 16 }}>
            <div style={{ fontSize: 28, fontWeight: 700 }}>{stats.verificationRate}%</div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>{t("mchk.verifyRate", locale)}</div>
          </div>
        </div>
      </section>

      <section className="surface-panel">
        <h3 style={{ margin: "0 0 12px 0", fontSize: 14 }}>{t("mchk.byEquipment", locale)}</h3>
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>{t("maintenance.equipmentNo", locale)}</th>
                <th>{t("maintenance.equipmentName", locale)}</th>
                <th>{t("mchk.scheduled", locale)}</th>
                <th>{t("mchk.completed", locale)}</th>
                <th>{t("mchk.missed", locale)}</th>
                <th>{t("mchk.complianceRate", locale)}</th>
              </tr>
            </thead>
            <tbody>
              {byEquip.map(e => (
                <tr key={e.equipmentId}>
                  <td>{e.equipmentCode}</td>
                  <td>{e.equipmentNameZh}</td>
                  <td>{e.scheduled}</td>
                  <td>{e.completed}</td>
                  <td>{e.missed > 0 ? <span style={{ color: "var(--danger)", fontWeight: 600 }}>{e.missed}</span> : e.missed}</td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ flex: 1, height: 8, background: "var(--border)", borderRadius: 4, overflow: "hidden" }}>
                        <div style={{ width: e.complianceRate + "%", height: "100%", background: e.complianceRate >= 80 ? "var(--success)" : e.complianceRate >= 50 ? "var(--warning)" : "var(--danger)", borderRadius: 4 }} />
                      </div>
                      <span style={{ fontSize: 12, fontWeight: e.complianceRate < 100 ? 600 : undefined, color: e.complianceRate >= 80 ? undefined : "var(--danger)" }}>{e.complianceRate}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function ScheduleView({ locale, schedule, templates }: { locale: Locale; schedule: ChecklistSchedule[]; templates: ChecklistTemplate[] }) {
  const today = new Date().toISOString().slice(0, 10);
  const [dateFilter, setDateFilter] = useState(today);

  const filtered = useMemo(() => schedule.filter(s => s.scheduledDate === dateFilter), [schedule, dateFilter]);

  const statusTone = (s: string) => {
    if (s === "completed") return "ok";
    if (s === "missed") return "danger";
    if (s === "overridden") return "warning";
    return "muted";
  };

  const getTemplateName = (tid: string) => templates.find(t => t.id === tid)?.templateName ?? tid;

  const equipName = (eid: string) => {
    const eq = demoEquipmentList.find(e => e.id === eid);
    return eq ? eq.code + " — " + eq.nameZh : eid;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="surface-panel">
        <div className="section-header">
          <h2>{t("mchk.schedule", locale)}</h2>
          <p>{t("mchk.scheduleDesc", locale)}</p>
        </div>
      </div>

      <section className="surface-panel">
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
          <label style={{ fontSize: 13, color: "var(--muted)" }}>{t("mchk.date", locale)}:</label>
          <input type="date" value={dateFilter} onChange={e => setDateFilter(e.target.value)} style={{ padding: "4px 8px" }} />
        </div>

        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>{t("mchk.equipment", locale)}</th>
                <th>{t("mchk.template", locale)}</th>
                <th>{t("mchk.frequency", locale)}</th>
                <th>{t("mchk.shift", locale)}</th>
                <th>{t("mchk.inspector", locale)}</th>
                <th>{t("mchk.status", locale)}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>{t("common.noData", locale)}</td></tr>
              )}
              {filtered.map(s => (
                <tr key={s.id}>
                  <td>{equipName(s.equipmentId)}</td>
                  <td>{getTemplateName(s.templateId)}</td>
                  <td>{t("mchk.freq." + s.frequency, locale)}</td>
                  <td>{s.shiftType}</td>
                  <td>{s.assignedInspector ?? "—"}</td>
                  <td><span className={`badge badge-${statusTone(s.status)}`}>{t("mchk.scheduleStatus." + s.status, locale)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export function EquipmentChecklists({ locale }: Props) {
  const [subTab, setSubTab] = useState<SubTab>("execute");
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([]);
  const [records, setRecords] = useState<CheckingRecord[]>([]);
  const [schedule, setSchedule] = useState<ChecklistSchedule[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (_useDemo) {
      setTemplates(demoData);
      setRecords(demoRecords);
      setSchedule(demoSchedule);
      setLoading(false);
      return;
    }
    Promise.all([
      maintenanceApi.getChecklistTemplates({}).then(r => setTemplates(r.items)).catch(() => {}),
      maintenanceApi.getCheckingRecords({}).then(r => setRecords(r.items)).catch(() => {}),
      maintenanceApi.getChecklistSchedule({}).then(r => setSchedule(r.items)).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, []);

  const subTabs: { key: SubTab; label: string }[] = [
    { key: "execute", label: t("mchk.subtab.execute", locale) },
    { key: "templates", label: t("mchk.subtab.templates", locale) },
    { key: "compliance", label: t("mchk.subtab.compliance", locale) },
    { key: "schedule", label: t("mchk.subtab.schedule", locale) },
  ];

  if (loading) {
    return (
      <div className="screen-stack">
        <section className="surface-panel">
          <div className="section-header">
            <h2>{t("mchk.title", locale)}</h2>
            <p>{t("mchk.subtitle", locale)}</p>
          </div>
          <div className="table-shell">
            <table>
              <thead><tr><th colSpan={5}><div className="skeleton" style={{ height: 14, width: 120 }} /></th></tr></thead>
              <tbody>
                {[1,2,3].map(i => (
                  <tr key={i}><td colSpan={5}><div className="skeleton" style={{ height: 14, width: "80%" }} /></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="screen-stack">
      <div className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("mchk.title", locale)}</h2>
            <p>{t("mchk.subtitle", locale)}</p>
          </div>
        </div>
        <div className="toolbar" style={{ marginTop: 8 }}>
          {subTabs.map(st => (
            <button key={st.key} type="button" className={subTab === st.key ? "active" : ""} onClick={() => setSubTab(st.key)}>{st.label}</button>
          ))}
        </div>
      </div>

      {subTab === "execute" && <ChecklistExecuteView locale={locale} templates={templates} records={records} />}
      {subTab === "templates" && <TemplatesView locale={locale} templates={templates} />}
      {subTab === "compliance" && <ComplianceView locale={locale} />}
      {subTab === "schedule" && <ScheduleView locale={locale} schedule={schedule} templates={templates} />}
    </div>
  );
}
