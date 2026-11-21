import { useState, useMemo, useEffect } from "react";
import { t } from "../i18n";
import type { Locale, ChecklistTemplate, ChecklistItem, CheckingRecord, CheckingRecordDetail, ChecklistSchedule, ComplianceSummary, ComplianceByEquipment, ComplianceByInspector } from "../../../../packages/shared-types/src/factory";
import { maintenanceApi } from "../api";

interface Props { locale: Locale }

type SubTab = "execute" | "templates" | "compliance" | "schedule";









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

  const equipName = (eid: string) => eid;

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
