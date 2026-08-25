import { useState, useEffect } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { hrApi } from "../api";
import { t } from "../i18n";

type CertTab = "certs" | "types" | "noCert" | "expiring";

export default function HrCertType({ locale }: { locale: Locale }) {
  const [tab, setTab] = useState<CertTab>("certs");
  const [certs, setCerts] = useState<any[]>([]);
  const [types, setTypes] = useState<any[]>([]);
  const [noCertEmps, setNoCertEmps] = useState<any[]>([]);
  const [expiringCerts, setExpiringCerts] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ employee_id: 0, cert_type_id: 0, cert_no: "", issued_date: "", expiry_date: "", notes: "" });
  const [typeForm, setTypeForm] = useState({ code: "", name_zh: "", name_en: "", name_vi: "", description: "", requires_exam: 1, passing_score: 60, validity_years: 2, renewal_required: 1, station_code: "" });

  const load = async () => {
    setLoading(true);
    try {
      const [c, t, n, e] = await Promise.all([
        hrApi.getEmployeeCertifications({}),
        hrApi.getCertTypes({ is_active: 1 }),
        hrApi.getEmployeeCertifications({ status: "none" }).catch(() => ({ data: [] })),
        hrApi.getEmployeeCertifications({}).then(r => (r.data || []).filter((x: any) => {
          if (!x.expiry_date) return false;
          const days = (new Date(x.expiry_date).getTime() - Date.now()) / 86400000;
          return days > 0 && days <= 30;
        })),
      ]);
      setCerts(c.data || []);
      setTypes(t.data || []);
      setNoCertEmps(n.data || []);
      setExpiringCerts(e);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const handleSave = async () => {
    if (!form.employee_id || !form.cert_type_id) return;
    await hrApi.createEmployeeCertification(form);
    setShowForm(false);
    setForm({ employee_id: 0, cert_type_id: 0, cert_no: "", issued_date: "", expiry_date: "", notes: "" });
    load();
  };

  const handleTypeSave = async () => {
    if (!typeForm.code || !typeForm.name_zh) return;
    await hrApi.createCertType(typeForm);
    setTypeForm({ code: "", name_zh: "", name_en: "", name_vi: "", description: "", requires_exam: 1, passing_score: 60, validity_years: 2, renewal_required: 1, station_code: "" });
    load();
  };

  const today = new Date().toISOString().slice(0, 10);

  const CertRow = ({ c }: { c: any }) => (
    <tr className={c.expiry_date && c.expiry_date < today ? "text-red-500" : ""}>
      <td className="border p-2">{c.emp_name}</td>
      <td className="border p-2">{c.emp_no}</td>
      <td className="border p-2">{c.cert_type_name}</td>
      <td className="border p-2">{c.cert_type_code}</td>
      <td className="border p-2">{c.cert_no}</td>
      <td className="border p-2">{c.issued_date}</td>
      <td className="border p-2">{c.expiry_date || "—"}</td>
      <td className="border p-2">
        <span className={`px-2 py-0.5 rounded text-xs ${c.status === "active" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
          {c.status === "active" ? t("hr.cert.tabCerts", locale) : c.status}
        </span>
      </td>
      <td className="border p-2">{c.notes || ""}</td>
    </tr>
  );

  return (
    <div className="p-4">
      <div className="flex gap-2 mb-4">
        {(["certs", "types", "noCert", "expiring"] as CertTab[]).map(tabKey => (
          <button key={tabKey} onClick={() => setTab(tabKey)} className={`px-4 py-1.5 rounded text-sm font-medium ${tab === tabKey ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700"}`}>
            {tabKey === "certs" ? t("hr.cert.tabCerts", locale) : tabKey === "types" ? t("hr.cert.tabTypes", locale) : tabKey === "noCert" ? t("hr.cert.tabNoCert", locale) : t("hr.cert.tabExpiring", locale)}
          </button>
        ))}
      </div>

      {loading && <p className="text-gray-500">{t("hr.cert.loading", locale)}</p>}

      {tab === "certs" && (
        <div>
          <div className="flex justify-between mb-3">
            <h3 className="font-bold">{t("hr.cert.tabCerts", locale)}</h3>
            <button onClick={() => { setShowForm(true); setForm({ employee_id: 0, cert_type_id: 0, cert_no: "", issued_date: today, expiry_date: "", notes: "" }); }} className="bg-blue-600 text-white px-3 py-1 rounded text-sm">+ {t("hr.cert.addCert", locale)}</button>
          </div>
          <table className="w-full text-sm border-collapse">
            <thead><tr className="bg-gray-50">
              <th className="border p-2 text-left">{t("hr.cert.name", locale)}</th>
              <th className="border p-2 text-left">{t("hr.cert.empNo", locale)}</th>
              <th className="border p-2 text-left">{t("hr.cert.certType", locale)}</th>
              <th className="border p-2 text-left">{t("hr.cert.code", locale)}</th>
              <th className="border p-2 text-left">{t("hr.cert.certNo", locale)}</th>
              <th className="border p-2 text-left">{t("hr.cert.issued", locale)}</th>
              <th className="border p-2 text-left">{t("hr.cert.expiry", locale)}</th>
              <th className="border p-2 text-left">{t("hr.cert.status", locale)}</th>
              <th className="border p-2 text-left">{t("hr.cert.notes", locale)}</th>
            </tr></thead>
            <tbody>{certs.map(c => <CertRow key={c.id} c={c} />)}</tbody>
          </table>
        </div>
      )}

      {tab === "types" && (
        <div>
          <div className="flex justify-between mb-3">
            <h3 className="font-bold">{t("hr.cert.tabTypes", locale)}</h3>
            <button onClick={() => setTypeForm({ code: "", name_zh: "", name_en: "", name_vi: "", description: "", requires_exam: 1, passing_score: 60, validity_years: 2, renewal_required: 1, station_code: "" })} className="bg-blue-600 text-white px-3 py-1 rounded text-sm">+ {t("hr.cert.addType", locale)}</button>
          </div>
          <table className="w-full text-sm border-collapse">
            <thead><tr className="bg-gray-50">
              <th className="border p-2 text-left">{t("hr.cert.code", locale)}</th>
              <th className="border p-2 text-left">{t("hr.cert.nameCN", locale)}</th>
              <th className="border p-2 text-left">{t("hr.cert.nameEN", locale)}</th>
              <th className="border p-2 text-left">{t("hr.cert.nameVI", locale)}</th>
              <th className="border p-2 text-left">{t("hr.cert.examReq", locale)}</th>
              <th className="border p-2 text-left">{t("hr.cert.passScore", locale)}</th>
              <th className="border p-2 text-left">{t("hr.cert.validity", locale)}</th>
              <th className="border p-2 text-left">{t("hr.cert.station", locale)}</th>
              <th className="border p-2 text-left">{t("hr.cert.active", locale)}</th>
            </tr></thead>
            <tbody>
              {types.map(t => (
                <tr key={t.id}>
                  <td className="border p-2 font-mono text-xs">{t.code}</td>
                  <td className="border p-2">{t.name_zh}</td>
                  <td className="border p-2">{t.name_en || ""}</td>
                  <td className="border p-2">{t.name_vi || ""}</td>
                  <td className="border p-2 text-center">{t.requires_exam ? "✓" : "—"}</td>
                  <td className="border p-2 text-center">{t.passing_score}</td>
                  <td className="border p-2 text-center">{t.validity_years}yr</td>
                  <td className="border p-2 font-mono text-xs">{t.station_code || "—"}</td>
                  <td className="border p-2 text-center">{t.is_active ? "✓" : "✗"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "expiring" && (
        <div>
          <h3 className="font-bold mb-3 text-orange-600">{t("hr.cert.tabExpiring", locale)}（≤30{t("hr.cert.expiringDays", locale)})</h3>
          <table className="w-full text-sm border-collapse">
            <thead><tr className="bg-orange-50">
              <th className="border p-2 text-left">{t("hr.cert.name", locale)}</th>
              <th className="border p-2 text-left">{t("hr.cert.empNo", locale)}</th>
              <th className="border p-2 text-left">{t("hr.cert.cert", locale)}</th>
              <th className="border p-2 text-left">{t("hr.cert.expiry", locale)}</th>
              <th className="border p-2 text-left">{t("hr.cert.expiryDaysLeft", locale)}</th>
            </tr></thead>
            <tbody>
              {expiringCerts.map(c => {
                const days = Math.ceil((new Date(c.expiry_date).getTime() - Date.now()) / 86400000);
                return (
                  <tr key={c.id} className="text-orange-600">
                    <td className="border p-2">{c.emp_name}</td>
                    <td className="border p-2">{c.emp_no}</td>
                    <td className="border p-2">{c.cert_type_name}</td>
                    <td className="border p-2">{c.expiry_date}</td>
                    <td className="border p-2 font-bold">{days}{t("hr.cert.expiryDays", locale)}</td>
                  </tr>
                );
              })}
              {expiringCerts.length === 0 && <tr><td colSpan={5} className="border p-4 text-center text-gray-400">—</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === "noCert" && (
        <div>
          <h3 className="font-bold mb-3 text-red-500">{t("hr.cert.tabNoCert", locale)}</h3>
          <p className="text-sm text-gray-500">{t("hr.cert.notImplemented", locale)}</p>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded p-6 w-[480px]">
            <h3 className="font-bold mb-4">{t("hr.cert.addCertificate", locale)}</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-xs text-gray-500">{t("hr.cert.employee", locale)}</label>
                <select className="w-full border rounded p-2" value={form.employee_id} onChange={e => setForm({ ...form, employee_id: Number(e.target.value) })}>
                  <option value={0}>—</option>
                  {employees.map(e => <option key={e.id} value={e.id}>{e.name_zh} ({e.code})</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="text-xs text-gray-500">{t("hr.cert.certType", locale)}</label>
                <select className="w-full border rounded p-2" value={form.cert_type_id} onChange={e => setForm({ ...form, cert_type_id: Number(e.target.value) })}>
                  <option value={0}>—</option>
                  {types.map(t => <option key={t.id} value={t.id}>{t.name_zh} [{t.code}]</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="text-xs text-gray-500">{t("hr.cert.certNo", locale)}</label>
                <input className="w-full border rounded p-2" value={form.cert_no} onChange={e => setForm({ ...form, cert_no: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-gray-500">{t("hr.cert.issuedDate", locale)}</label>
                <input type="date" className="w-full border rounded p-2" value={form.issued_date} onChange={e => setForm({ ...form, issued_date: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-gray-500">{t("hr.cert.expiryDate", locale)}</label>
                <input type="date" className="w-full border rounded p-2" value={form.expiry_date} onChange={e => setForm({ ...form, expiry_date: e.target.value })} />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-gray-500">{t("hr.cert.notes", locale)}</label>
                <input className="w-full border rounded p-2" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded bg-gray-100">{t("hr.cert.cancelBtn", locale)}</button>
              <button onClick={handleSave} className="px-4 py-2 rounded bg-blue-600 text-white">{t("hr.cert.saveBtn", locale)}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
