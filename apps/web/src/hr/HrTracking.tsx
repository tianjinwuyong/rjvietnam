import { useState, useEffect } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { hrApi } from "../api";
import { t } from "../i18n";

type TrackTab = "records" | "add";
const trackingTypes = [
  { value: "follow_up", label_zh: "定期跟踪", label_en: "Follow-up", label_vi: "Theo dõi" },
  { value: "performance_review", label_zh: "绩效回顾", label_en: "Perf Review", label_vi: "Đánh giá" },
  { value: "retrain_needed", label_zh: "需复训", label_en: "Retrain", label_vi: "Cần đào tạo lại" },
  { value: "cert_renewal", label_zh: "证书续期", label_en: "Cert Renewal", label_vi: "Gia hạn" },
];
const perfRatings = [
  { value: "A", label_zh: "优秀", label_en: "Excellent", label_vi: "Xuất sắc" },
  { value: "B", label_zh: "良好", label_en: "Good", label_vi: "Tốt" },
  { value: "C", label_zh: "一般", label_en: "Average", label_vi: "TB" },
  { value: "D", label_zh: "差", label_en: "Poor", label_vi: "Kém" },
];

export default function HrTracking({ locale }: { locale: Locale }) {
  const [tab, setTab] = useState<TrackTab>("records");
  const [records, setRecords] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    employee_id: 0, tracking_type: "follow_up", tracking_date: new Date().toISOString().slice(0, 10),
    outcome_zh: "", score: 0, performance_rating: "", next_follow_up_date: "", next_follow_up_type: "follow_up", trainer_feedback: "",
  });

  const load = async () => {
    setLoading(true);
    try {
      const [r, e] = await Promise.all([hrApi.getTrainingTracking({}), hrApi.getEmployees({ status: "active" })]);
      setRecords(r.data || []);
      setEmployees(e.data || []);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const handleSave = async () => {
    if (!form.employee_id || !form.tracking_date) return;
    await hrApi.createTrainingTracking(form);
    setTab("records");
    setForm({ employee_id: 0, tracking_type: "follow_up", tracking_date: new Date().toISOString().slice(0, 10), outcome_zh: "", score: 0, performance_rating: "", next_follow_up_date: "", next_follow_up_type: "follow_up", trainer_feedback: "" });
    load();
  };

  const shortLocale = locale === "zh-CN" ? "zh" : locale === "vi-VN" ? "vi" : "en";
  const tLabel = (item: typeof trackingTypes[0]) => item[`label_${shortLocale}` as keyof typeof item] || item.label_zh;
  const rLabel = (item: typeof perfRatings[0]) => item[`label_${shortLocale}` as keyof typeof item] || item.label_zh;

  const L = {
    zh: { title: "培训跟踪", records: "跟踪记录", add: "新增跟踪", emp: "员工", date: "跟踪日期", type: "跟踪类型", outcome: "跟踪结果", score: "绩效分", rating: "绩效等级", feedback: "培训师反馈", nextDate: "下次跟踪日期", nextType: "下次跟踪类型", addBtn: "新增", no: "工号", name: "姓名", dept: "部门" },
    en: { title: "Training Tracking", records: "Records", add: "New", emp: "Employee", date: "Date", type: "Type", outcome: "Outcome", score: "Score", rating: "Rating", feedback: "Trainer Feedback", nextDate: "Next Date", nextType: "Next Type", addBtn: "Add", no: "Emp No", name: "Name", dept: "Dept" },
    vi: { title: "Theo dõi training", records: "Hồ sơ", add: "Thêm mới", emp: "NV", date: "Ngày", type: "Loại", outcome: "Kết quả", score: "Điểm", rating: "Xếp loại", feedback: "Phản hồi", nextDate: "Ngày tiếp", nextType: "Loại tiếp", addBtn: "Thêm", no: "Mã NV", name: "Tên", dept: "BP" },
  };
  const l = L[shortLocale];

  const ratingColor = (r: string) => {
    if (r === "A") return "bg-green-100 text-green-700";
    if (r === "B") return "bg-blue-100 text-blue-700";
    if (r === "C") return "bg-yellow-100 text-yellow-700";
    if (r === "D") return "bg-red-100 text-red-700";
    return "bg-gray-50";
  };

  return (
    <div className="p-4">
      <div className="flex gap-2 mb-4">
        <button onClick={() => setTab("records")} className={`px-4 py-1.5 rounded text-sm font-medium ${tab === "records" ? "bg-blue-600 text-white" : "bg-gray-100"}`}>{l.records}</button>
        <button onClick={() => setTab("add")} className={`px-4 py-1.5 rounded text-sm font-medium ${tab === "add" ? "bg-blue-600 text-white" : "bg-gray-100"}`}>+ {l.add}</button>
      </div>

      {loading && <p className="text-gray-500">Loading...</p>}

      {tab === "records" && (
        <table className="w-full text-sm border-collapse">
          <thead><tr className="bg-gray-50">
            <th className="border p-2 text-left">{l.no}</th>
            <th className="border p-2 text-left">{l.name}</th>
            <th className="border p-2 text-left">{l.dept}</th>
            <th className="border p-2 text-left">{l.date}</th>
            <th className="border p-2 text-left">{l.type}</th>
            <th className="border p-2 text-left">{l.outcome}</th>
            <th className="border p-2 text-left">{l.score}</th>
            <th className="border p-2 text-left">{l.rating}</th>
            <th className="border p-2 text-left">{l.feedback}</th>
            <th className="border p-2 text-left">{l.nextDate}</th>
          </tr></thead>
          <tbody>
            {records.map(r => (
              <tr key={r.id}>
                <td className="border p-2">{r.emp_no}</td>
                <td className="border p-2">{r.emp_name}</td>
                <td className="border p-2">{r.dept_name || ""}</td>
                <td className="border p-2">{r.tracking_date}</td>
                <td className="border p-2">{tLabel(trackingTypes.find(t => t.value === r.tracking_type) || trackingTypes[0])}</td>
                <td className="border p-2 max-w-xs truncate">{r.outcome_zh || ""}</td>
                <td className="border p-2 text-center">{r.score > 0 ? r.score : "—"}</td>
                <td className="border p-2"><span className={`px-2 py-0.5 rounded text-xs ${ratingColor(r.performance_rating)}`}>{r.performance_rating || "—"}</span></td>
                <td className="border p-2 max-w-xs truncate text-gray-500">{r.trainer_feedback || ""}</td>
                <td className="border p-2">{r.next_follow_up_date || "—"}</td>
              </tr>
            ))}
            {records.length === 0 && <tr><td colSpan={10} className="border p-4 text-center text-gray-400">—</td></tr>}
          </tbody>
        </table>
      )}

      {tab === "add" && (
        <div className="max-w-2xl">
          <h3 className="font-bold mb-4">{l.add}</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-500">{l.emp}</label>
              <select className="w-full border rounded p-2" value={form.employee_id} onChange={e => setForm({ ...form, employee_id: Number(e.target.value) })}>
                <option value={0}>—</option>
                {employees.map(e => <option key={e.id} value={e.id}>{e.name_zh} ({e.code})</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500">{l.date}</label>
              <input type="date" className="w-full border rounded p-2" value={form.tracking_date} onChange={e => setForm({ ...form, tracking_date: e.target.value })} />
            </div>
            <div>
              <label className="text-xs text-gray-500">{l.type}</label>
              <select className="w-full border rounded p-2" value={form.tracking_type} onChange={e => setForm({ ...form, tracking_type: e.target.value })}>
                {trackingTypes.map(t => <option key={t.value} value={t.value}>{tLabel(t)}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500">{l.rating}</label>
              <select className="w-full border rounded p-2" value={form.performance_rating} onChange={e => setForm({ ...form, performance_rating: e.target.value })}>
                <option value="">—</option>
                {perfRatings.map(r => <option key={r.value} value={r.value}>{rLabel(r)}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500">{l.score}（0-100）</label>
              <input type="number" className="w-full border rounded p-2" value={form.score || ""} min={0} max={100} onChange={e => setForm({ ...form, score: Number(e.target.value) })} />
            </div>
            <div>
              <label className="text-xs text-gray-500">{l.nextDate}</label>
              <input type="date" className="w-full border rounded p-2" value={form.next_follow_up_date} onChange={e => setForm({ ...form, next_follow_up_date: e.target.value })} />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-gray-500">{l.outcome}</label>
              <textarea className="w-full border rounded p-2" rows={2} value={form.outcome_zh} onChange={e => setForm({ ...form, outcome_zh: e.target.value })} placeholder={t("hr.tracking.outcomePlaceholder", locale)} />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-gray-500">{l.feedback}</label>
              <textarea className="w-full border rounded p-2" rows={2} value={form.trainer_feedback} onChange={e => setForm({ ...form, trainer_feedback: e.target.value })} placeholder={t("hr.tracking.feedbackPlaceholder", locale)} />
            </div>
          </div>
          <div className="flex justify-end mt-4">
            <button onClick={handleSave} className="px-6 py-2 rounded bg-blue-600 text-white">{l.addBtn}</button>
          </div>
        </div>
      )}
    </div>
  );
}
