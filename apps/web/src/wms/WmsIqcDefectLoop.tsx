import { useCallback, useEffect, useMemo, useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { apiClient } from "../api/client";

type Tab = "qr" | "iqc" | "defects" | "mrb" | "rework" | "reinspection";
type Row = Record<string, any>;

const tabs: Array<[Tab, string]> = [
  ["qr", "QR receiving document"], ["iqc", "IQC result"], ["defects", "Defect files"],
  ["mrb", "MRB review"], ["rework", "Rework return"], ["reinspection", "IQC reinspection"],
];

function value(row: Row, ...keys: string[]) {
  const found = keys.map((key) => row[key]).find((item) => item !== undefined && item !== null && item !== "");
  return found === undefined ? "-" : String(found);
}

export function WmsIqcDefectLoop({ locale: _locale }: { locale: Locale }) {
  const [tab, setTab] = useState<Tab>("qr");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ lotId: "", lotNo: "", sourceType: "PO_RECEIPT", warehouse: "IQC-PENDING", location: "", quantity: "", operator: "operator", defectId: "", qrId: "", result: "PASS", decision: "REWORK", defectCode: "" });
  const endpoint = useMemo(() => ({ qr: "/wms/receiving/qr-bindings", iqc: "/wms/receiving/qr-bindings", defects: "/quality/iqc-defect-cases", mrb: "/quality/iqc-mrb-tasks", rework: "/quality/iqc-defect-cases", reinspection: "/quality/iqc-reinspections" }[tab]), [tab]);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { const response: any = await apiClient.get(endpoint); setRows(response.items ?? response.data ?? response ?? []); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setLoading(false); }
  }, [endpoint]);
  useEffect(() => { void load(); }, [load]);
  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const post = async (path: string, body: Row) => { setError(""); try { await apiClient.post(path, body); await load(); } catch (err) { setError(err instanceof Error ? err.message : String(err)); } };
  const createQr = () => post("/wms/receiving/qr-bindings", { materialLotId: Number(form.lotId), lotNo: form.lotNo, sourceType: tab === "rework" ? "REWORK_RETURN" : form.sourceType, warehouse: form.warehouse, location: form.location, quantity: Number(form.quantity), operator: form.operator });
  const field = (key: keyof typeof form, placeholder: string) => <input value={form[key]} placeholder={placeholder} onChange={(event) => set(key, event.target.value)} />;
  return <div className="screen-stack"><section className="surface-panel">
    <div className="section-header"><div><h2>IQC defect closed loop</h2><p>Receiving todo -&gt; system QR document -&gt; IQC -&gt; finished goods or defect warehouse -&gt; MRB</p></div><button onClick={() => void load()}>Refresh</button></div>
    <div style={{ overflowX: "auto", marginBottom: 16, width: "100%" }}><img src="/iqc-mrb-closed-loop.svg" alt="IQC and MRB material closed loop" style={{ display: "block", width: "100%", maxWidth: "1400px", height: "auto", border: "1px solid #d1d5db" }} /></div>
    {error && <p style={{ color: "#b91c1c" }}>{error}</p>}
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "14px 0" }}>{tabs.map(([key, label]) => <button key={key} className={tab === key ? "btn btn-primary" : "btn btn-secondary"} onClick={() => setTab(key)}>{label}</button>)}</div>
    {(tab === "qr" || tab === "rework") && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
      {field("lotId", "Material lot ID")}{field("lotNo", "Lot number")}{field("quantity", "Quantity")}{field("location", "Location")}{field("operator", "Operator")}
      {tab === "qr" && <><select value={form.sourceType} onChange={(event) => set("sourceType", event.target.value)}><option value="PO_RECEIPT">PO receipt</option><option value="LINE_RETURN">Line return</option><option value="REWORK_RETURN">MRB rework return</option><option value="SUBCONTRACT_RETURN">Subcontract return</option></select>{field("warehouse", "IQC-PENDING warehouse")}</>}
      {tab === "rework" && <><button className="btn btn-secondary" onClick={() => void post(`/quality/iqc-defect-cases/${form.defectId}/rework-complete`, { operator: form.operator })}>Mark rework complete</button><button className="btn btn-primary" onClick={() => void createQr()}>Create rework QR document</button></>}
      {tab === "qr" && <button className="btn btn-primary" onClick={() => void createQr()}>Generate system QR document</button>}
    </div>}
    {tab === "iqc" && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>{field("lotId", "Material lot ID")}{field("defectCode", "Defect code if failed")}{field("operator", "Operator")}<select value={form.result} onChange={(event) => set("result", event.target.value)}><option value="PASS">PASS - release to finished goods</option><option value="FAIL">FAIL - move to defect warehouse</option></select><button className="btn btn-primary" onClick={() => void post(`/wms/receiving/qr-bindings/${form.lotId}/iqc-result`, { result: form.result, defectCode: form.defectCode, operator: form.operator })}>Submit IQC result</button></div>}
    {tab === "defects" && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>{field("defectId", "Defect case ID")}{field("operator", "Operator")}<button className="btn btn-primary" onClick={() => void post(`/quality/iqc-defect-cases/${form.defectId}/pallet-removal`, { operator: form.operator })}>Confirm pallet removal</button></div>}
    {tab === "mrb" && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>{field("defectId", "Defect case ID")}{field("operator", "Reviewer")}<select value={form.decision} onChange={(event) => set("decision", event.target.value)}><option value="REWORK">Rework</option><option value="SCRAP">Scrap</option><option value="VENDOR_RETURN">Vendor return</option></select><button className="btn btn-primary" onClick={() => void post(`/quality/iqc-defect-cases/${form.defectId}/mrb`, { decision: form.decision, operator: form.operator })}>Submit MRB decision</button></div>}
    {tab === "reinspection" && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>{field("defectId", "Defect case ID")}{field("qrId", "Rework QR document number")}{field("operator", "Inspector")}<button className="btn btn-primary" onClick={() => void post("/quality/iqc-reinspections", { caseId: Number(form.defectId), qrDocumentNo: form.qrId, operator: form.operator })}>Create reinspection</button></div>}
    <div className="table-shell"><table><thead><tr>{["ID", "Document / case", "Lot", "Source / status", "Quantity", "Action"].map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{loading ? <tr><td colSpan={6}>Loading...</td></tr> : rows.length === 0 ? <tr><td colSpan={6}>No records</td></tr> : rows.map((row) => <tr key={row.id}><td>{value(row, "id", "material_lot_id")}</td><td>{value(row, "document_no", "case_no", "task_no")}</td><td>{value(row, "lot_no", "lotNo")}</td><td>{value(row, "source_type", "status", "decision")}</td><td>{value(row, "quantity", "defective_qty")}</td><td>{tab === "qr" && value(row, "status") === "PENDING" && <button onClick={() => void post(`/wms/receiving/qr-bindings/${row.id}/confirm`, { operator: form.operator })}>Confirm receiving</button>}{tab === "reinspection" && ["OPEN", "PENDING"].includes(String(row.status)) && <><button onClick={() => void post(`/quality/iqc-reinspections/${row.id}/complete`, { result: "PASS", operator: form.operator })}>PASS</button><button onClick={() => void post(`/quality/iqc-reinspections/${row.id}/complete`, { result: "FAIL", operator: form.operator })}>FAIL</button></>}</td></tr>)}</tbody></table></div>
  </section></div>;
}
