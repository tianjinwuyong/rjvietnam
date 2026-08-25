import { useState, useEffect, useMemo, useRef } from "react";
import * as XLSX from "xlsx";
import { Download, Upload, Edit2, Check, X } from "lucide-react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { hrApi } from "../api";
import type { PerformanceReview, PerformanceKpi, PerformanceReviewItem } from "../api";

const RATING_COLORS: Record<string, string> = {
  A: "#22c55e", B: "#3b82f6", C: "#f59e0b", D: "#ef4444", F: "#dc2626",
};
const STATUS_COLORS: Record<string, string> = {
  draft: "#6b7280", submitted: "#3b82f6", confirmed: "#22c55e",
};

function localeName(locale: Locale, name_zh: string, _name_en: string, name_vi: string) {
  if (locale === "zh-CN") return name_zh;
  if (locale === "en-US") return name_zh;
  return name_vi;
}

function RatingBadge({ rating }: { rating: string | null }) {
  if (!rating) return <span style={{ color: "#6b7280" }}>—</span>;
  return (
    <span style={{
      display: "inline-block", padding: "2px 10px", borderRadius: 12,
      background: (RATING_COLORS[rating] ?? "#6b7280") + "22",
      color: RATING_COLORS[rating] ?? "#6b7280",
      fontWeight: 700, fontSize: 12,
    }}>
      {rating}
    </span>
  );
}

interface EditModalProps {
  review: PerformanceReview | null;
  kpis: PerformanceKpi[];
  employees: Array<{ id: number; name_zh: string; name_vi: string }>;
  locale: Locale;
  onClose: () => void;
  onSave: (payload: {
    employee_id: number; period_type: string; period_value: string;
    review_date: string; items: PerformanceReviewItem[];
  }) => Promise<void>;
}

function EditModal({ review, kpis, employees, locale, onClose, onSave }: EditModalProps) {
  const [employee_id, setEmployeeId] = useState(review?.employee_id ?? 0);
  const [period_type, setPeriodType] = useState<"monthly"|"quarterly"|"annual">(review?.period_type ?? "monthly");
  const [period_value, setPeriodValue] = useState(review?.period_value ?? "");
  const [review_date, setReviewDate] = useState(review?.review_date?.slice(0, 10) ?? "");
  const [items, setItems] = useState<PerformanceReviewItem[]>(
    review ? [] : kpis.map((k) => ({
      kpi_name_zh: k.name_zh, kpi_name_en: k.name_en, kpi_name_vi: k.name_vi,
      target: k.target_max, actual: 0, unit: k.unit, weight: k.weight, score: 0, comment: "",
    }))
  );
  const [saving, setSaving] = useState(false);

  const totalScore = items.reduce((s, i) => s + (i.score || 0) * (i.weight || 0) / 100, 0);

  const handleSave = async () => {
    if (!employee_id || !period_value || !review_date) return;
    setSaving(true);
    try {
      await onSave({ employee_id, period_type, period_value, review_date, items });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000,
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div className="surface-panel" style={{ width: 700, maxHeight: "85vh", overflowY: "auto", padding: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
          <h3>{review ? "编辑绩效评估" : "新建绩效评估"}</h3>
          <button onClick={onClose} className="btn-ghost"><X size={16} /></button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
          <div className="field">
            <span>员工</span>
            <select className="field-input" value={employee_id} onChange={(e) => setEmployeeId(Number(e.target.value))}>
              <option value={0}>— 选择员工 —</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>{localeName(locale, e.name_zh, e.name_zh, e.name_vi)}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <span>周期类型</span>
            <select className="field-input" value={period_type} onChange={(e) => setPeriodType(e.target.value as "monthly"|"quarterly"|"annual")}>
              <option value="monthly">月度</option>
              <option value="quarterly">季度</option>
              <option value="annual">年度</option>
            </select>
          </div>
          <div className="field">
            <span>周期值 (如 2026-01)</span>
            <input className="field-input" value={period_value} onChange={(e) => setPeriodValue(e.target.value)} placeholder="2026-01" />
          </div>
          <div className="field">
            <span>评估日期</span>
            <input className="field-input" type="date" value={review_date} onChange={(e) => setReviewDate(e.target.value)} />
          </div>
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginBottom: 12 }}>
          <thead>
            <tr style={{ background: "var(--surface-1)" }}>
              {["KPI", "目标", "实际", "单位", "权重%", "得分"].map((h) => (
                <th key={h} style={{ padding: "6px 8px", textAlign: h === "KPI" ? "left" : "center" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                <td style={{ padding: "4px 8px" }}>{localeName(locale, item.kpi_name_zh, item.kpi_name_en, item.kpi_name_vi)}</td>
                <td style={{ padding: "4px" }}><input type="number" className="field-input" style={{ height: 28, padding: "0 6px" }} value={item.target} onChange={(e) => { const n = [...items]; n[i] = { ...n[i], target: Number(e.target.value) }; setItems(n); }} /></td>
                <td style={{ padding: "4px" }}><input type="number" className="field-input" style={{ height: 28, padding: "0 6px" }} value={item.actual} onChange={(e) => { const n = [...items]; n[i] = { ...n[i], actual: Number(e.target.value) }; setItems(n); }} /></td>
                <td style={{ padding: "4px 8px", color: "var(--muted)", textAlign: "center" }}>{item.unit}</td>
                <td style={{ padding: "4px 8px", textAlign: "center" }}>{item.weight}%</td>
                <td style={{ padding: "4px" }}><input type="number" className="field-input" style={{ height: 28, padding: "0 6px", width: 60 }} value={item.score} min={0} max={100} onChange={(e) => { const n = [...items]; n[i] = { ...n[i], score: Number(e.target.value) }; setItems(n); }} /></td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <span style={{ fontSize: 13, color: "var(--muted)" }}>
            综合得分: <strong style={{ color: totalScore >= 75 ? "#22c55e" : totalScore >= 60 ? "#f59e0b" : "#ef4444" }}>{totalScore.toFixed(1)}</strong>
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onClose} className="btn-ghost">取消</button>
            <button onClick={handleSave} className="action-button" disabled={saving || !employee_id || !period_value}>
              {saving ? "保存中..." : "保存"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function HrPerformance({ locale }: { locale: Locale }) {
  const [reviews, setReviews] = useState<PerformanceReview[]>([]);
  const [kpis, setKpis] = useState<PerformanceKpi[]>([]);
  const [employees, setEmployees] = useState<Array<{ id: number; name_zh: string; name_vi: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [editReview, setEditReview] = useState<PerformanceReview | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () => {
    setLoading(true);
    Promise.all([
      hrApi.getPerformanceReviews({}),
      hrApi.getPerformanceKpis(),
      hrApi.getEmployees({ limit: 200 }),
    ]).then(([r, k, e]) => {
      setReviews(r.items);
      setKpis(k.items);
      setEmployees(e.items.map((emp) => ({ id: emp.id, name_zh: emp.name_zh ?? emp.displayName ?? "", name_vi: emp.name_vi ?? "" })));
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    return reviews.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (typeFilter !== "all" && r.period_type !== typeFilter) return false;
      return true;
    });
  }, [reviews, statusFilter, typeFilter]);

  const handleExport = () => {
    const data = filtered.map((r) => ({
      "工号": r.employee_no,
      "姓名(ZH)": r.name_zh,
      "姓名(VI)": r.name_vi,
      "周期类型": r.period_type,
      "周期值": r.period_value,
      "评估日期": r.review_date?.slice(0, 10),
      "综合得分": r.total_score,
      "评级": r.rating,
      "状态": r.status,
      "评语": r.overall_comment ?? "",
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "绩效评估");
    XLSX.writeFile(wb, `performance_${new Date().toISOString().slice(0, 10)}.xlsx`);
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
          const items = kpis.map((k) => ({
            kpi_name_zh: k.name_zh, kpi_name_en: k.name_en, kpi_name_vi: k.name_vi,
            target: k.target_max, actual: 0, unit: k.unit, weight: k.weight, score: 0, comment: "",
          }));
          await hrApi.createPerformanceReview({
            employee_id: emp.id,
            period_type: String(row["周期类型"] || "monthly"),
            period_value: String(row["周期值"] || ""),
            review_date: String(row["评估日期"] || new Date().toISOString().slice(0, 10)),
            items,
          });
          imported++;
        }
        alert(`成功导入 ${imported} 条绩效记录`);
        load();
      } catch (err) {
        alert("导入失败: " + (err as Error).message);
      }
    };
    reader.readAsArrayBuffer(file);
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleSave = async (payload: {
    employee_id: number; period_type: string; period_value: string;
    review_date: string; items: PerformanceReviewItem[];
  }) => {
    if (editReview) {
      await hrApi.updatePerformanceReview(editReview.id, { items: payload.items, status: "submitted" });
    } else {
      await hrApi.createPerformanceReview(payload);
    }
    load();
  };

  if (loading) return <div style={{ padding: 24, color: "var(--muted)" }}>{t("common.loading", locale)}...</div>;

  return (
    <div className="screen-stack">
      <div className="surface-panel">
        <div className="section-header">
          <div>
            <h2>绩效管理</h2>
            <p>{t("page.hr", locale)}</p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn-ghost" onClick={handleExport} title="导出Excel">
              <Download size={14} /> 导出
            </button>
            <button className="btn-ghost" onClick={() => fileRef.current?.click()} title="导入Excel">
              <Upload size={14} /> 导入
            </button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={handleImport} />
            <button className="action-button" onClick={() => { setEditReview(null); setShowCreate(true); }}>
              + 新建
            </button>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          {(["all", "draft", "submitted", "confirmed"] as const).map((s) => (
            <button key={s} className={`btn-ghost ${statusFilter === s ? "active" : ""}`} onClick={() => setStatusFilter(s)}>
              {s === "all" ? "全部" : s === "draft" ? "草稿" : s === "submitted" ? "已提交" : "已确认"}
            </button>
          ))}
          <span style={{ borderLeft: "1px solid var(--border)", margin: "0 4px" }} />
          {(["all", "monthly", "quarterly", "annual"] as const).map((s) => (
            <button key={s} className={`btn-ghost ${typeFilter === s ? "active" : ""}`} onClick={() => setTypeFilter(s)}>
              {s === "all" ? "全部类型" : s === "monthly" ? "月度" : s === "quarterly" ? "季度" : "年度"}
            </button>
          ))}
        </div>
      </div>

      <section className="surface-panel">
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>工号</th><th>姓名</th><th>周期</th><th>评估日期</th>
                <th>综合得分</th><th>评级</th><th>状态</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--muted)", padding: 32 }}>暂无数据</td></tr>
              ) : filtered.map((r) => (
                <tr key={r.id}>
                  <td><strong>{r.employee_no}</strong></td>
                  <td>{localeName(locale, r.name_zh, r.name_zh, r.name_vi)}</td>
                  <td>{r.period_type === "monthly" ? "月度" : r.period_type === "quarterly" ? "季度" : "年度"} {r.period_value}</td>
                  <td>{r.review_date?.slice(0, 10)}</td>
                  <td><strong>{r.total_score?.toFixed(1)}</strong></td>
                  <td><RatingBadge rating={r.rating ?? null} /></td>
                  <td><span style={{ color: STATUS_COLORS[r.status] ?? "#6b7280", fontSize: 12 }}>
                    {r.status === "draft" ? "草稿" : r.status === "submitted" ? "已提交" : "已确认"}
                  </span></td>
                  <td>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button className="btn-ghost" style={{ padding: "4px 8px", fontSize: 12 }} onClick={() => { setEditReview(r); setShowCreate(true); }}>
                        <Edit2 size={12} />
                      </button>
                      {r.status !== "confirmed" && (
                        <button className="btn-ghost" style={{ padding: "4px 8px", fontSize: 12 }} onClick={async () => {
                          await hrApi.updatePerformanceReview(r.id, { status: "confirmed" });
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
        <div style={{ padding: "8px 12px", fontSize: 11, color: "var(--muted)" }}>共 {filtered.length} 条</div>
      </section>

      {showCreate && (
        <EditModal
          review={editReview}
          kpis={kpis}
          employees={employees}
          locale={locale}
          onClose={() => { setShowCreate(false); setEditReview(null); }}
          onSave={handleSave}
        />
      )}
    </div>
  );
}
