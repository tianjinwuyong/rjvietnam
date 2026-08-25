import { useState, useEffect, useMemo, useRef } from "react";
import * as XLSX from "xlsx";
import { Download, Upload, Edit2, Check, X } from "lucide-react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { hrApi } from "../api";
import type { SalaryRecord } from "../api/hr";

const STATUS_COLORS: Record<string, string> = {
  draft: "#6b7280", confirmed: "#3b82f6", paid: "#22c55e",
};

function fmt(n: number) {
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", minimumFractionDigits: 0 }).format(n);
}
function localeName(locale: Locale, name_zh: string, _name_en: string, name_vi: string) {
  if (locale === "zh-CN") return name_zh;
  if (locale === "en-US") return name_zh;
  return name_vi;
}

interface EditModalProps {
  record: SalaryRecord | null;
  employees: Array<{ id: number; name_zh: string; name_vi: string }>;
  locale: Locale;
  onClose: () => void;
  onSave: (payload: Omit<SalaryRecord, "id" | "name_zh" | "name_vi" | "employee_no" | "gross_salary" | "total_deductions" | "net_salary" | "status" | "paid_at">) => Promise<void>;
}

function EditModal({ record, employees, locale, onClose, onSave }: EditModalProps) {
  const [employee_id, setEmployeeId] = useState(record?.employee_id ?? 0);
  const [year, setYear] = useState(record?.year ?? new Date().getFullYear());
  const [month, setMonth] = useState(record?.month ?? new Date().getMonth() + 1);
  const [base_salary, setBaseSalary] = useState(record?.base_salary ?? 0);
  const [normal_days, setNormalDays] = useState(record?.normal_days ?? 22);
  const [absent_days, setAbsentDays] = useState(record?.absent_days ?? 0);
  const [late_count, setLateCount] = useState(record?.late_count ?? 0);
  const [early_count, setEarlyCount] = useState(record?.early_count ?? 0);
  const [ot_hours, setOtHours] = useState(record?.ot_hours ?? 0);
  const [ot_rate, setOtRate] = useState(record?.ot_rate ?? 1.5);
  const [allowances_total, setAllowances] = useState(record?.allowances_total ?? 0);
  const [bonus_performance, setBonusPerf] = useState(record?.bonus_performance ?? 0);
  const [bonus_attendance, setBonusAtt] = useState(record?.bonus_attendance ?? 0);
  const [bonus_other, setBonusOther] = useState(record?.bonus_other ?? 0);
  const [deduction_late, setDedLate] = useState(record?.deduction_late ?? 0);
  const [deduction_absent, setDedAbsent] = useState(record?.deduction_absent ?? 0);
  const [deduction_other, setDedOther] = useState(record?.deduction_other ?? 0);
  const [personal_tax, setTax] = useState(record?.personal_tax ?? 0);
  const [social_insurance, setSI] = useState(record?.social_insurance ?? 0);
  const [health_insurance, setHI] = useState(record?.health_insurance ?? 0);
  const [unemployment_ins, setUI] = useState(record?.unemployment_ins ?? 0);
  const [saving, setSaving] = useState(false);

  const ot_pay = ot_hours * base_salary / 240 * ot_rate;
  const gross = base_salary + ot_pay + allowances_total + bonus_performance + bonus_attendance + bonus_other;
  const total_ded = deduction_late + deduction_absent + deduction_other + personal_tax + social_insurance + health_insurance + unemployment_ins;
  const net = gross - total_ded;

  const handleSave = async () => {
    if (!employee_id) return;
    setSaving(true);
    try {
      await onSave({
        employee_id, year, month, base_salary,
        normal_days, absent_days, late_count, early_count,
        ot_hours, ot_rate, allowances_total,
        bonus_performance, bonus_attendance, bonus_other,
        deduction_late, deduction_absent, deduction_other,
        personal_tax, social_insurance, health_insurance, unemployment_ins,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const nf = (n: number) => new Intl.NumberFormat("vi-VN", { minimumFractionDigits: 0 }).format(n);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", overflowY: "auto" }}>
      <div className="surface-panel" style={{ width: 640, maxHeight: "90vh", overflowY: "auto", padding: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
          <h3>{record ? t("hr.salary.editRecord", locale) : t("hr.salary.newRecord", locale)}</h3>
          <button onClick={onClose} className="btn-ghost"><X size={16} /></button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 16 }}>
          <div className="field">
            <span>{t("hr.salary.employee", locale)}</span>
            <select className="field-input" value={employee_id} onChange={(e) => setEmployeeId(Number(e.target.value))}>
              <option value={0}>{t("hr.salary.selectEmployee", locale)}</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>{localeName(locale, e.name_zh, e.name_zh, e.name_vi)}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <span>{t("hr.salary.year", locale)}</span>
            <input className="field-input" type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} />
          </div>
          <div className="field">
            <span>{t("hr.salary.month", locale)}</span>
            <input className="field-input" type="number" min={1} max={12} value={month} onChange={(e) => setMonth(Number(e.target.value))} />
          </div>
        </div>

          <div style={{ background: "var(--surface-1)", borderRadius: 8, padding: "10px 12px", marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8, color: "var(--text-2)" }}>{t("hr.salary.attendanceSalary", locale)}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
            {[
              [t("hr.salary.baseSalary", locale), base_salary, setBaseSalary],
              [t("hr.salary.normalDays", locale), normal_days, setNormalDays],
              [t("hr.salary.absentDays", locale), absent_days, setAbsentDays],
              [t("hr.salary.lateCount", locale), late_count, setLateCount],
              [t("hr.salary.earlyCount", locale), early_count, setEarlyCount],
              [t("hr.salary.otHours", locale), ot_hours, setOtHours],
              [t("hr.salary.otRate", locale), ot_rate, setOtRate],
              [t("hr.salary.totalAllowances", locale), allowances_total, setAllowances],
            ].map(([label, value, setter]) => (
              <div key={String(label)} className="field">
                <span>{String(label)}</span>
                <input className="field-input" type="number" value={Number(value)} min={0}
                  onChange={(e) => (setter as (v: number) => void)(Number(e.target.value))} />
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 16 }}>
          {[
            [t("hr.salary.perfBonus", locale), bonus_performance, setBonusPerf],
            [t("hr.salary.attendanceBonus", locale), bonus_attendance, setBonusAtt],
            [t("hr.salary.otherBonus", locale), bonus_other, setBonusOther],
            [t("hr.salary.lateDeduction", locale), deduction_late, setDedLate],
            [t("hr.salary.absentDeduction", locale), deduction_absent, setDedAbsent],
            [t("hr.salary.otherDeduction", locale), deduction_other, setDedOther],
            [t("hr.salary.personalTax", locale), personal_tax, setTax],
            [t("hr.salary.socialIns", locale), social_insurance, setSI],
            [t("hr.salary.healthIns", locale), health_insurance, setHI],
          ].map(([label, value, setter]) => (
            <div key={String(label)} className="field">
              <span>{String(label)}</span>
              <input className="field-input" type="number" value={Number(value)} min={0}
                onChange={(e) => (setter as (v: number) => void)(Number(e.target.value))} />
            </div>
          ))}
          <div className="field">
            <span>{t("hr.salary.unemploymentIns", locale)}</span>
            <input className="field-input" type="number" value={unemployment_ins} min={0}
              onChange={(e) => setUI(Number(e.target.value))} />
          </div>
        </div>

        <div style={{ background: "#1a1a2e", borderRadius: 8, padding: "12px 16px", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 16, color: "#fff" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 11, opacity: 0.7 }}>{t("hr.salary.grossSalary", locale)}</div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{nf(gross)}</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 11, opacity: 0.7 }}>{t("hr.salary.totalDeductions", locale)}</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#ef4444" }}>{nf(total_ded)}</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 11, opacity: 0.7 }}>{t("hr.salary.netSalary", locale)}</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#22c55e" }}>{nf(net)}</div>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onClose} className="btn-ghost">{t("hr.salary.cancel", locale)}</button>
          <button onClick={handleSave} className="action-button" disabled={saving || !employee_id}>
            {saving ? t("hr.salary.saving", locale) : t("hr.salary.save", locale)}
          </button>
        </div>
      </div>
    </div>
  );
}

export function HrSalary({ locale }: { locale: Locale }) {
  const [records, setRecords] = useState<SalaryRecord[]>([]);
  const [employees, setEmployees] = useState<Array<{ id: number; name_zh: string; name_vi: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [yearFilter, setYearFilter] = useState(new Date().getFullYear());
  const [editRecord, setEditRecord] = useState<SalaryRecord | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () => {
    setLoading(true);
    Promise.all([
      hrApi.getSalaryRecords({ year: yearFilter }),
      hrApi.getEmployees({ limit: 200 }),
    ]).then(([r, e]) => {
      setRecords(r.items);
      setEmployees(e.items.map((emp) => ({ id: emp.id, name_zh: emp.name_zh ?? emp.displayName ?? "", name_vi: emp.name_vi ?? "" })));
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, [yearFilter]);

  const filtered = useMemo(() => {
    if (statusFilter === "all") return records;
    return records.filter((r) => r.status === statusFilter);
  }, [records, statusFilter]);

  const totals = useMemo(() => ({
    gross: filtered.reduce((s, r) => s + r.gross_salary, 0),
    net: filtered.reduce((s, r) => s + r.net_salary, 0),
    count: filtered.length,
  }), [filtered]);

  const handleExport = () => {
    const empNoHdr = t("hr.salary.empNo", locale);
    const nameZhHdr = t("hr.salary.nameZh", locale);
    const nameViHdr = t("hr.salary.nameVi", locale);
    const yearHdr = t("hr.salary.year", locale);
    const monthHdr = t("hr.salary.month", locale);
    const baseSalHdr = t("hr.salary.baseSalary", locale);
    const normalDaysHdr = t("hr.salary.normalDays", locale);
    const lateCountHdr = t("hr.salary.lateCount", locale);
    const absentHdr = t("hr.salary.absent", locale);
    const otHrsHdr = t("hr.salary.otHours", locale);
    const otRateHdr = t("hr.salary.otRate", locale);
    const allowHdr = t("hr.salary.totalAllowances", locale);
    const perfBnsHdr = t("hr.salary.perfBonus", locale);
    const attBnsHdr = t("hr.salary.attendanceBonus", locale);
    const othBnsHdr = t("hr.salary.otherBonus", locale);
    const lateDedHdr = t("hr.salary.lateDeduction", locale);
    const absDedHdr = t("hr.salary.absentDeduction", locale);
    const othDedHdr = t("hr.salary.otherDeduction", locale);
    const taxHdr = t("hr.salary.personalTax", locale);
    const siHdr = t("hr.salary.socialInsurance", locale);
    const hiHdr = t("hr.salary.healthInsurance", locale);
    const uiHdr = t("hr.salary.unemploymentInsurance", locale);
    const grossHdr = t("hr.salary.grossSalary", locale);
    const totalDedHdr = t("hr.salary.totalDeductions", locale);
    const netHdr = t("hr.salary.netSalary", locale);
    const statusHdr = t("hr.salary.status", locale);
    const data = filtered.map((r) => ({
      [empNoHdr]: r.employee_no,
      [nameZhHdr]: r.name_zh,
      [nameViHdr]: r.name_vi,
      [yearHdr]: r.year,
      [monthHdr]: r.month,
      [baseSalHdr]: r.base_salary,
      [normalDaysHdr]: r.normal_days,
      [absentHdr]: r.absent_days,
      [lateCountHdr]: r.late_count,
      [otHrsHdr]: r.ot_hours,
      [otRateHdr]: r.ot_rate,
      [allowHdr]: r.allowances_total,
      [perfBnsHdr]: r.bonus_performance,
      [attBnsHdr]: r.bonus_attendance,
      [othBnsHdr]: r.bonus_other,
      [lateDedHdr]: r.deduction_late,
      [absDedHdr]: r.deduction_absent,
      [othDedHdr]: r.deduction_other,
      [taxHdr]: r.personal_tax,
      [siHdr]: r.social_insurance,
      [hiHdr]: r.health_insurance,
      [uiHdr]: r.unemployment_ins,
      [grossHdr]: r.gross_salary,
      [totalDedHdr]: r.total_deductions,
      [netHdr]: r.net_salary,
      [statusHdr]: r.status,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `${t("hr.salary.salarySheet", locale)}_${yearFilter}`);
    XLSX.writeFile(wb, `salary_${yearFilter}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const wb = XLSX.read(ev.target?.result, { type: "array" });
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]) as Record<string, unknown>[];
        let imported = 0;
        for (const row of rows) {
          const emp = employees.find((em) => em.name_zh === row["姓名(ZH)"]);
          if (!emp) continue;
          await hrApi.upsertSalaryRecord({
            employee_id: emp.id,
            year: Number(row["年份"]),
            month: Number(row["月份"]),
            base_salary: Number(row["基本工资"]) || 0,
            normal_days: Number(row["正常出勤"]) || 0,
            absent_days: Number(row["缺勤"]) || 0,
            late_count: Number(row["迟到次数"]) || 0,
            early_count: Number(row["早退次数"]) || 0,
            ot_hours: Number(row["加班小时"]) || 0,
            ot_rate: Number(row["加班倍率"]) || 1.5,
            allowances_total: Number(row["补贴合计"]) || 0,
            bonus_performance: Number(row["绩效奖金"]) || 0,
            bonus_attendance: Number(row["全勤奖金"]) || 0,
            bonus_other: Number(row["其他奖金"]) || 0,
            deduction_late: Number(row["迟到扣款"]) || 0,
            deduction_absent: Number(row["缺勤扣款"]) || 0,
            deduction_other: Number(row["其他扣款"]) || 0,
            personal_tax: Number(row["个人所得税"]) || 0,
            social_insurance: Number(row["社保"]) || 0,
            health_insurance: Number(row["医保"]) || 0,
            unemployment_ins: Number(row["失业险"]) || 0,
          });
          imported++;
        }
        alert(t("hr.salary.importSuccess", locale) + imported + t("hr.salary.records", locale));
        load();
      } catch (err) {
        alert(t("hr.salary.importFail", locale) + (err as Error).message);
      }
    };
    reader.readAsArrayBuffer(file);
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleSave = async (payload: Omit<SalaryRecord, "id" | "name_zh" | "name_vi" | "employee_no" | "gross_salary" | "total_deductions" | "net_salary" | "status" | "paid_at">) => {
    await hrApi.upsertSalaryRecord(payload as Parameters<typeof hrApi.upsertSalaryRecord>[0]);
    load();
  };

  if (loading) return <div style={{ padding: 24, color: "var(--muted)" }}>{t("common.loading", locale)}...</div>;

  return (
    <div className="screen-stack">
      <div className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("hr.salary.title", locale)}</h2>
            <p>{t("page.hr", locale)}</p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input
              type="number"
              className="field-input"
              style={{ width: 90, height: 32 }}
              value={yearFilter}
              onChange={(e) => setYearFilter(Number(e.target.value))}
            />
            <button className="btn-ghost" onClick={handleExport}>
              <Download size={14} /> {t("hr.salary.export", locale)}
            </button>
            <button className="btn-ghost" onClick={() => fileRef.current?.click()}>
              <Upload size={14} /> {t("hr.salary.import", locale)}
            </button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={handleImport} />
            <button className="action-button" onClick={() => { setEditRecord(null); setShowCreate(true); }}>
              + {t("hr.salary.create", locale)}
            </button>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        {(["all", "draft", "confirmed", "paid"] as const).map((s) => (
            <button key={s} className={`btn-ghost ${statusFilter === s ? "active" : ""}`} onClick={() => setStatusFilter(s)}>
              {s === "all" ? t("hr.salary.filterAll", locale) : s === "draft" ? t("hr.salary.filterDraft", locale) : s === "confirmed" ? t("hr.salary.filterConfirmed", locale) : t("hr.salary.filterPaid", locale)}
            </button>
          ))}
          <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)", alignSelf: "center" }}>
            {t("hr.salary.gross", locale)}: <strong style={{ color: "var(--text-1)" }}>{new Intl.NumberFormat("vi-VN", { minimumFractionDigits: 0 }).format(totals.gross)}</strong>
            &nbsp;|
            &nbsp;
            {t("hr.salary.net", locale)}: <strong style={{ color: "#22c55e" }}>{new Intl.NumberFormat("vi-VN", { minimumFractionDigits: 0 }).format(totals.net)}</strong>
          </span>
        </div>
      </div>

      <section className="surface-panel">
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>{t("hr.salary.empNo", locale)}</th>
                <th>{t("hr.salary.name", locale)}</th>
                <th>{t("hr.salary.period", locale)}</th>
                <th>{t("hr.salary.baseSalary", locale)}</th>
                <th>{t("hr.salary.ot", locale)}</th>
                <th>{t("hr.salary.bonus", locale)}</th>
                <th>{t("hr.salary.deduction", locale)}</th>
                <th>{t("hr.salary.gross", locale)}</th>
                <th>{t("hr.salary.net", locale)}</th>
                <th>{t("hr.salary.status", locale)}</th>
                <th>{t("hr.salary.action", locale)}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={11} style={{ textAlign: "center", color: "var(--muted)", padding: 32 }}>{t("hr.salary.noData", locale)}</td></tr>
              ) : filtered.map((r) => (
                <tr key={r.id}>
                  <td><strong>{r.employee_no}</strong></td>
                  <td>{localeName(locale, r.name_zh, r.name_zh, r.name_vi)}</td>
                  <td>{r.year}/{String(r.month).padStart(2, "0")}</td>
                  <td style={{ textAlign: "right" }}>{new Intl.NumberFormat("vi-VN", { minimumFractionDigits: 0 }).format(r.base_salary)}</td>
                  <td style={{ textAlign: "right" }}>{new Intl.NumberFormat("vi-VN", { minimumFractionDigits: 0 }).format(r.ot_hours * r.base_salary / 240 * r.ot_rate)}</td>
                  <td style={{ textAlign: "right", color: "#22c55e" }}>
                    {new Intl.NumberFormat("vi-VN", { minimumFractionDigits: 0 }).format(r.bonus_performance + r.bonus_attendance + r.bonus_other)}
                  </td>
                  <td style={{ textAlign: "right", color: "#ef4444" }}>
                    {new Intl.NumberFormat("vi-VN", { minimumFractionDigits: 0 }).format(r.total_deductions)}
                  </td>
                  <td style={{ textAlign: "right", fontWeight: 600 }}>{new Intl.NumberFormat("vi-VN", { minimumFractionDigits: 0 }).format(r.gross_salary)}</td>
                  <td style={{ textAlign: "right", fontWeight: 700, color: "#22c55e" }}>{new Intl.NumberFormat("vi-VN", { minimumFractionDigits: 0 }).format(r.net_salary)}</td>
                  <td>
                    <span style={{ color: STATUS_COLORS[r.status] ?? "#6b7280", fontSize: 12 }}>
                      {r.status === "draft" ? t("hr.salary.filterDraft", locale) : r.status === "confirmed" ? t("hr.salary.filterConfirmed", locale) : t("hr.salary.filterPaid", locale)}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button className="btn-ghost" style={{ padding: "4px 8px", fontSize: 12 }} onClick={() => { setEditRecord(r); setShowCreate(true); }}>
                        <Edit2 size={12} />
                      </button>
                      {r.status === "draft" && (
                        <button className="btn-ghost" style={{ padding: "4px 8px", fontSize: 12 }} onClick={async () => {
                          await hrApi.confirmSalaryRecord(r.id, "confirmed");
                          load();
                        }}>
                          <Check size={12} />
                        </button>
                      )}
                      {r.status === "confirmed" && (
                        <button className="btn-ghost" style={{ padding: "4px 8px", fontSize: 12, color: "#22c55e" }} onClick={async () => {
                          await hrApi.confirmSalaryRecord(r.id, "paid");
                          load();
                        }}>
                          <Check size={12} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ padding: "8px 12px", fontSize: 11, color: "var(--muted)" }}>
          {t("hr.salary.totalRecords", locale)}{filtered.length}{t("hr.salary.records", locale)}
        </div>
      </section>

      {showCreate && (
        <EditModal
          record={editRecord}
          employees={employees}
          locale={locale}
          onClose={() => { setShowCreate(false); setEditRecord(null); }}
          onSave={handleSave}
        />
      )}
    </div>
  );
}
